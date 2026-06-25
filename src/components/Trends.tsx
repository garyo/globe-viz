import { For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { appState, setAppState, saveState, type SourceId, type DatasetId } from '../stores/appState';
import { fetchTimeseries, type TimeseriesPayload } from '../lib/data/timeseries';
import {
  type ThemeColors,
  type YearSeries,
  dayLabel,
  groupByYear,
  lerpHex,
  readThemeColors,
} from '../lib/timeseriesUtils';
import { TrendsGrid } from './TrendsGrid';

// Human labels for known region IDs; mirrors regions.REGIONS in
// sea-surface-temp-viz/regions.py. Unknown IDs fall back to the ID itself.
const REGION_LABELS: Record<string, string> = {
  global: 'Global (60°S–60°N)',
  trop: 'Tropics (23.5°S–23.5°N)',
  n_hemi: 'Northern Hemisphere',
  s_hemi: 'Southern Hemisphere',
  nino_3_4: 'Niño 3.4',
  pacific: 'Pacific Ocean',
  atlantic: 'Atlantic Ocean',
  indian: 'Indian Ocean',
  arctic: 'Arctic Ocean',
  antarctic: 'Southern Ocean',
};

echarts.use([
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

const SOURCE_LABELS: Record<SourceId, string> = {
  oisst: 'NOAA OISST',
  era5: 'ECMWF ERA5',
  gfs: 'NOAA GFS',
};

const DATASET_AXIS_LABELS: Record<DatasetId, string> = {
  sst: 'SST (°C)',
  anom: 'Anomaly vs. 1971–2000 mean (°C)',
  sst_anom: 'SST Anomaly vs. 1971–2000 mean (°C)',
  t2m: '2 m Air Temp (°C)',
  t2m_anom: '2 m Air Temp Anomaly vs. 1971–2000 mean (°C)',
  t2m_mean: 'Daily Mean 2 m Air Temp (°C)',
  t2m_max: 'Daily Max 2 m Air Temp (°C)',
  t2m_min: 'Daily Min 2 m Air Temp (°C)',
  t2m_mean_anom: 'Daily Mean 2 m Air Temp Anomaly vs. 1971–2000 mean (°C)',
  t2m_max_anom: 'Daily Max 2 m Air Temp Anomaly vs. 1971–2000 mean (°C)',
  t2m_min_anom: 'Daily Min 2 m Air Temp Anomaly vs. 1971–2000 mean (°C)',
};

const DATASET_TITLE_FRAGMENT: Record<DatasetId, string> = {
  sst: 'Sea Surface Temperature',
  anom: 'SST Anomaly vs. 1971–2000 mean',
  sst_anom: 'SST Anomaly vs. 1971–2000 mean',
  t2m: '2 m Air Temperature',
  t2m_anom: '2 m Air Temp Anomaly vs. 1971–2000 mean',
  t2m_mean: 'Daily Mean 2 m Air Temperature',
  t2m_max: 'Daily Max 2 m Air Temperature',
  t2m_min: 'Daily Min 2 m Air Temperature',
  t2m_mean_anom: 'Daily Mean 2 m Air Temp Anomaly vs. 1971–2000 mean',
  t2m_max_anom: 'Daily Max 2 m Air Temp Anomaly vs. 1971–2000 mean',
  t2m_min_anom: 'Daily Min 2 m Air Temp Anomaly vs. 1971–2000 mean',
};

// Phone-width titles: the full fragment + year range doesn't fit.
const DATASET_TITLE_SHORT: Record<DatasetId, string> = {
  sst: 'Sea Surface Temp',
  anom: 'SST Anomaly',
  sst_anom: 'SST Anomaly',
  t2m: 'Air Temp',
  t2m_anom: 'Air Temp Anomaly',
  t2m_mean: 'Mean Air Temp',
  t2m_max: 'Max Air Temp',
  t2m_min: 'Min Air Temp',
  t2m_mean_anom: 'Mean Air Temp Anomaly',
  t2m_max_anom: 'Max Air Temp Anomaly',
  t2m_min_anom: 'Min Air Temp Anomaly',
};

/** Layout regime for the single chart, derived from the container size.
 * `narrow` reworks the chart for phone-portrait widths (short title,
 * horizontal legend, tight margins); `short` reclaims vertical space on
 * phone-landscape heights. */
interface ChartLayout {
  narrow: boolean;
  short: boolean;
}

function findRecord(yearsSeries: YearSeries[]): { year: number; doy: number; value: number } | null {
  let best: { year: number; doy: number; value: number } | null = null;
  for (const s of yearsSeries) {
    for (const [doy, v] of s.data) {
      if (v === null) continue; // gap-break marker
      if (best === null || v > best.value) best = { year: s.year, doy, value: v };
    }
  }
  return best;
}

interface NearestLine {
  year: number;
  value: number; // the line's (interpolated) value at `doy`
  color: string;
}

/**
 * Find the year-line closest to a (doy, val) data coordinate, used by both the
 * click-to-pin and hover-to-read interactions. For each series we linearly
 * interpolate its value at `doy` and keep the one whose value is nearest `val`,
 * skipping `null` gap-break segments. Returns null when the nearest line is
 * farther than `maxPx` pixels away (so clicks/hovers in empty space don't latch
 * onto a distant line); the threshold is measured in pixels so it's consistent
 * across zoom levels and y-ranges.
 */
function nearestLine(
  chart: echarts.ECharts,
  doy: number,
  val: number,
  maxPx: number,
): NearestLine | null {
  const opt = chart.getOption() as {
    series?: Array<{ name?: string; data?: Array<[number, number | null]>; lineStyle?: { color?: string } }>;
  };
  const seriesList = opt.series ?? [];

  let best: NearestLine | null = null;
  let bestDist = Infinity;
  for (const s of seriesList) {
    const data = s.data;
    if (!data || data.length === 0) continue;
    let yAtDoy: number | null = null;
    for (let i = 0; i + 1 < data.length; i++) {
      const [x0, y0] = data[i];
      const [x1, y1] = data[i + 1];
      if (y0 === null || y1 === null) continue; // don't interpolate across a gap
      if (x0 <= doy && doy <= x1) {
        const t = x1 === x0 ? 0 : (doy - x0) / (x1 - x0);
        yAtDoy = y0 + (y1 - y0) * t;
        break;
      }
    }
    if (yAtDoy === null) continue;
    const d = Math.abs(yAtDoy - val);
    if (d < bestDist) {
      bestDist = d;
      best = { year: Number(s.name), value: yAtDoy, color: s.lineStyle?.color ?? '#888' };
    }
  }
  if (!best) return null;

  // Reject if the nearest line is too far in screen space.
  const linePx = chart.convertToPixel({ gridIndex: 0 }, [doy, best.value])[1];
  const curPx = chart.convertToPixel({ gridIndex: 0 }, [doy, val])[1];
  if (Math.abs(linePx - curPx) > maxPx) return null;
  return best;
}

/**
 * Pick how many decimals the y-axis labels need so that consecutive ticks
 * don't round to the same string. Reads the chart's current y-axis view
 * range — when zoomed in tightly, ECharts picks small tick intervals
 * (e.g. 0.05) and one decimal is no longer enough to distinguish them.
 * Returns at least 1 decimal so the label column width is stable when
 * we're not zoomed in tight.
 */
function yLabelDecimals(chart: echarts.ECharts | undefined): number {
  if (!chart) return 1;
  try {
    const opt = chart.getOption() as {
      dataZoom?: Array<{ type?: string; yAxisIndex?: number; startValue?: number; endValue?: number }>;
    };
    const dz = (opt.dataZoom ?? []).find((z) => z.type === 'inside' && z.yAxisIndex === 0);
    if (!dz || dz.startValue === undefined || dz.endValue === undefined) return 1;
    const range = dz.endValue - dz.startValue;
    // splitNumber=10 so tick interval ≈ range/10. Need enough decimals to
    // distinguish ticks that are this far apart.
    const interval = range / 10;
    // Need enough decimals so two adjacent ticks (interval apart) display
    // differently. The threshold is interval >= 10^-n for n decimals.
    if (interval >= 0.1) return 1;
    if (interval >= 0.01) return 2;
    if (interval >= 0.001) return 3;
    return 4;
  } catch {
    return 1;
  }
}

function buildOption(
  payload: TimeseriesPayload,
  source: SourceId,
  dataset: DatasetId,
  c: ThemeColors,
  selectedYear: number | null,
  chart: echarts.ECharts | undefined,
  layout: ChartLayout,
): EChartsOption {
  const { narrow, short } = layout;
  const compact = narrow || short;
  const series = payload.sources[source]?.datasets[dataset];
  if (!series) {
    return {
      title: {
        text: `No ${SOURCE_LABELS[source]} ${dataset} data for this region`,
        left: 'center',
        textStyle: { color: c.text },
      },
    };
  }

  const years = groupByYear(series);
  if (years.length === 0) {
    return { title: { text: 'No data', left: 'center', textStyle: { color: c.text } } };
  }

  const firstYear = years[0].year;
  const lastYear = years[years.length - 1].year;
  const yearRange = Math.max(1, lastYear - firstYear);
  const record = findRecord(years);

  const echartsSeries = years.map((s) => {
    const t = (s.year - firstYear) / yearRange;
    let color = lerpHex(c.yearOld, c.yearRecent, t);
    let lineWidth = 0.7;
    let z = 1;
    if (s.year === lastYear) {
      color = c.yearCurrent;
      lineWidth = 2;
      z = 10;
    } else if (s.year === lastYear - 1) {
      color = c.yearPrev;
      lineWidth = 1.5;
      z = 9;
    } else if (s.year === lastYear - 2) {
      color = c.yearPrev2;
      lineWidth = 1.2;
      z = 8;
    }
    if (s.year === selectedYear) {
      lineWidth = Math.max(lineWidth, 4);
      z = 100;
    }
    return {
      name: String(s.year),
      type: 'line' as const,
      data: s.data,
      showSymbol: false,
      smooth: false,
      sampling: 'lttb' as const,
      lineStyle: { width: lineWidth, color },
      itemStyle: { color },
      z,
      // `silent` stops ECharts from doing its own mouse-driven hover-emphasis.
      // With 44 series that repainted all 43 non-hovered lines every time the
      // mouse crossed a new series — the source of the old flicker. We drive
      // highlighting ourselves (nearestLine + dispatchAction) so only one line
      // repaints at a time. `focus: 'none'` keeps the other lines untouched
      // when a line is emphasized; programmatic highlight still works on a
      // silent series.
      silent: true,
      emphasis: {
        focus: 'none' as const,
        lineStyle: { width: Math.max(lineWidth + 1.5, 3), color },
      },
    };
  });

  const datasetLabel = DATASET_AXIS_LABELS[dataset];
  const regionLabel = payload.region_label || REGION_LABELS[payload.region] || payload.region;
  const title = narrow
    ? `${regionLabel} — ${DATASET_TITLE_SHORT[dataset]}`
    : `${regionLabel} — ${DATASET_TITLE_FRAGMENT[dataset]}, ${firstYear}–${lastYear}`;

  // Match the static graph's labeling: the two oldest years and the five
  // most recent (current year + four prior). Newest first so the current
  // year sits at the top of the legend.
  const legendYears = years
    .map((s) => s.year)
    .filter((y) => y > lastYear - 5 || y < firstYear + 2)
    .sort((a, b) => b - a)
    .map(String);

  // Annotations: the all-time record value and the most recent data point.
  // Both ride on the latest year's series so a single markPoint config covers
  // them — the per-item label.formatter overrides the shared default.
  const latestYearSeries = echartsSeries.find((s) => s.name === String(lastYear));
  if (latestYearSeries) {
    const markData: Array<{
      coord: [number, number];
      label: { formatter: string; position?: string };
    }> = [];

    if (record) {
      markData.push({
        coord: [record.doy, record.value],
        label: {
          formatter: `record: ${dayLabel(record.doy)}, ${record.year}\n${record.value.toFixed(2)}°C`,
          // The record sits near the top of the plot; on compact layouts a
          // label above it collides with the title/legend band, so tuck it
          // beside the dot, on whichever side has room.
          position: compact ? (record.doy < 183 ? 'right' : 'left') : 'top',
        },
      });
    }

    const latestPoints = years[years.length - 1].data;
    const lastReal = [...latestPoints].reverse().find((p) => p[1] !== null) as
      | [number, number]
      | undefined;
    if (lastReal) {
      const [doy, val] = lastReal;
      markData.push({
        coord: [doy, val],
        label: {
          formatter: `${dayLabel(doy)}, ${lastYear}\n${val.toFixed(2)}°C`,
          // Late-year points sit near the right edge; keep the label inside
          // the plot on narrow screens.
          position: narrow ? 'left' : 'right',
        },
      });
    }

    if (markData.length > 0) {
      (latestYearSeries as { markPoint?: unknown }).markPoint = {
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: c.yearRecord, borderColor: c.text, borderWidth: 1 },
        label: { color: c.text, fontSize: narrow ? 10 : 11 },
        data: markData,
      };
    }
  }

  return {
    backgroundColor: 'transparent',
    // Disable transition animations: with 44 series × 16k points the canvas
    // repaint cost on every tooltip update is high, and animations make the
    // chart visibly flicker as the renderer chases mouse moves.
    animation: false,
    title: {
      text: title,
      // The source/count subtitle is the first thing to go when space is
      // tight — it overlaps the record annotation on phone screens.
      subtext: compact
        ? undefined
        : `Source: ${SOURCE_LABELS[source]} · area-weighted average · ${series.dates.length.toLocaleString()} daily values`,
      left: 'center',
      textStyle: { color: c.text, fontSize: narrow ? 13 : 16 },
      subtextStyle: { color: c.subtitle, fontSize: 11 },
    },
    grid: {
      left: narrow ? 44 : 60,
      right: narrow ? 14 : 30,
      // compact: one-line title plus the horizontal legend row.
      top: narrow ? 58 : short ? 62 : 70,
      bottom: compact ? 48 : 80,
    },
    // No tooltip. An axis-trigger tooltip would `highlight` every series at the
    // hovered x (the axis-pointer's "show all related data" behavior), which
    // with emphasis enabled lights up nearly all 44 lines at once. Instead the
    // cursor lights up the single nearest year-line (see the zr 'mousemove'
    // handler) and its value shows in a fixed corner readout that never covers
    // the data. A standalone axis-pointer draws just the vertical crosshair —
    // it renders the reference line without emphasizing any series.
    tooltip: { show: false },
    axisPointer: {
      show: true,
      type: 'line',
      triggerOn: 'mousemove',
      triggerTooltip: false,
      lineStyle: { color: c.axis },
      label: { show: false },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 365,
      axisLine: { lineStyle: { color: c.axis } },
      axisLabel: {
        color: c.text,
        formatter: (v: number) => dayLabel(v),
      },
      splitLine: { show: false },
      // Dashed crosshair lines on both axes mark the cursor's exact position
      // (the native cursor is hidden via CSS). The standalone axis-pointer
      // (configured at the top level) only draws the reference lines — unlike
      // an axis-trigger tooltip, it doesn't emphasize any series.
      axisPointer: { show: true },
    },
    yAxis: {
      type: 'value',
      axisPointer: { show: true },
      // The axis name overlaps the tick labels and record annotation on
      // small screens; the title already identifies the dataset there.
      name: compact ? undefined : datasetLabel,
      nameTextStyle: { color: c.text },
      axisLine: { lineStyle: { color: c.axis } },
      // Format labels with just enough precision to distinguish adjacent
      // ticks. At full zoom the y range is ~1.5°C and ticks are at 0.2°C
      // — 1 decimal works. When zoomed in tightly the interval drops to
      // 0.05 or 0.01 and 1 decimal collapses neighboring ticks into the
      // same string ("20.2, 20.2, 20.3, 20.3"). yLabelDecimals queries
      // the current dataZoom range and picks an interval-appropriate
      // precision.
      axisLabel: { color: c.text, formatter: (v: number) => v.toFixed(yLabelDecimals(chart)) },
      splitLine: { lineStyle: { color: c.grid } },
      scale: true,
      // Hint for tick count: with the default (5) and bounds pinned to the
      // raw data extent, ECharts ends up subdividing into ugly 0.3-style
      // steps. 10 nudges the algorithm toward the 1/2/5 family at the next
      // finer magnitude (e.g. 0.2 for a ~1.5°C range). On short plots 10
      // ticks crowd into each other; halve it there.
      splitNumber: short ? 5 : 10,
      // Tie the axis range exactly to the data, no auto-padding. Without
      // this, scale:true pads ~5% above and below, which means the rendered
      // y range is wider than what dataZoom (which talks in data-extent
      // values) can address — our wheel handler computes a new range based
      // on the wider rendered extent, ECharts then clamps to the narrower
      // data extent, and the first zoom either visibly snaps or no-ops.
      min: 'dataMin',
      max: 'dataMax',
    },
    dataZoom: [
      // Native wheel zoom disabled — we handle it ourselves so we can
      // tame sensitivity and anchor the zoom on the cursor. moveOnMouseMove
      // (drag-to-pan) stays enabled.
      { type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: false },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: compact ? 14 : 20,
        bottom: compact ? 6 : 30,
        textStyle: { color: c.text },
        borderColor: c.axis,
        fillerColor: c.grid,
        backgroundColor: 'transparent',
      },
      { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: false },
    ],
    // compact: a single legend row under the title, where it can't cover the
    // data. Otherwise the classic floating box at the right of the plot.
    legend: compact
      ? {
          show: true,
          data: legendYears,
          selectedMode: false,
          orient: 'horizontal',
          top: narrow ? 26 : 30,
          left: 'center',
          itemWidth: 12,
          itemHeight: 2,
          itemGap: 5,
          textStyle: { color: c.text, fontSize: 10 },
        }
      : {
          show: true,
          data: legendYears,
          selectedMode: false,
          orient: 'vertical',
          right: 40,
          bottom: 90,
          itemWidth: 18,
          itemHeight: 2,
          itemGap: 6,
          textStyle: { color: c.text, fontSize: 11 },
          backgroundColor: c.tooltipBg,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          borderRadius: 4,
          padding: [6, 10],
        },
    series: echartsSeries,
  };
}

export const Trends = () => {
  let chartRef: HTMLDivElement | undefined;
  let chart: echarts.ECharts | undefined;
  let resizeHandler: (() => void) | undefined;
  let wheelHandler: ((e: WheelEvent) => void) | undefined;
  let hoverRaf = 0; // pending requestAnimationFrame id for the hover resolver
  // Circle drawn where the cursor's time crosses the highlighted line — added
  // directly to zrender (not via setOption) so it can be repositioned every
  // frame cheaply. Theme colors are cached so the marker ring stays correct.
  let marker: InstanceType<typeof echarts.graphic.Circle> | undefined;
  let themeColors: ThemeColors | undefined;

  // Track the current region from appState so the resource refetches whenever
  // the user changes the selection.
  const region = () => appState.region;

  const [payload] = createResource(region, fetchTimeseries);

  const sourceKey = (): SourceId => appState.source;
  const datasetKey = (): DatasetId => appState.dataset;

  // Click-to-highlight: stores the year the user last clicked, or null for
  // "no manual highlight" (only the default current/prev-year styling applies).
  const [selectedYear, setSelectedYear] = createSignal<number | null>(null);

  // Hover-to-read: the nearest year-line under the cursor and its value, shown
  // in the fixed corner readout. null when the cursor is off the plot or far
  // from any line.
  const [hover, setHover] = createSignal<NearestLine & { doy: number } | null>(null);

  // Container-size layout regime, re-measured on resize so the chart
  // restyles itself when e.g. a phone rotates. 0×0 (hidden container)
  // keeps the previous regime.
  const [chartLayout, setChartLayout] = createSignal<ChartLayout>({ narrow: false, short: false });
  const measureLayout = () => {
    if (!chartRef) return;
    const w = chartRef.clientWidth;
    const h = chartRef.clientHeight;
    if (w === 0 || h === 0) return;
    setChartLayout({ narrow: w < 620, short: h < 420 });
  };

  onMount(() => {
    if (!chartRef) return;
    chart = echarts.init(chartRef, undefined, { renderer: 'canvas' });
    measureLayout();

    // The hover marker rides above every line (z beats the selected-year line's
    // z of 100). Added once to the zrender root; it survives setOption since
    // it's not part of the ECharts model. Positioned/styled per hover.
    marker = new echarts.graphic.Circle({
      silent: true,
      z: 999,
      shape: { cx: 0, cy: 0, r: 4.5 },
      style: { fill: '#000', stroke: '#fff', lineWidth: 1.5 },
    });
    marker.hide();
    chart.getZr().add(marker);
    resizeHandler = () => {
      chart?.resize();
      measureLayout();
    };
    window.addEventListener('resize', resizeHandler);

    // Wheel zoom: take over from ECharts so we can (a) tame the sensitivity
    // and (b) anchor the zoom on the cursor on BOTH axes simultaneously.
    // Attached in capture phase so we run before any ECharts/zrender wheel
    // handler; ECharts' built-in zoom-on-wheel is disabled via
    // zoomOnMouseWheel: false on both inside zooms.
    //
    // We work entirely in axis-value space (not percentages) to avoid an
    // auto-padding gotcha on the y-axis: the rendered axis range can be
    // wider than the dataZoom-implied range (so axis.scale.getExtent() ≠
    // the [startValue, endValue] of the dataZoom). Mixing the two made
    // the first y-zoom jump (padding evaporated on the first dispatch)
    // and shifted the cursor anchor. dispatchAction with startValue /
    // endValue talks to ECharts in the same space as dz.startValue /
    // dz.endValue, so nothing drifts.
    const ZOOM_PER_DELTA = 0.001; // exp(deltaY * k) ≈ 10% range change per wheel notch (deltaY=100)

    const zoomAxis = (
      axis: 'x' | 'y',
      mouseDataVal: number,
      factor: number,
    ): { startValue: number; endValue: number; index: number } | null => {
      if (!chart) return null;
      const axisKey = axis === 'y' ? 'yAxisIndex' : 'xAxisIndex';
      const opt = chart.getOption() as {
        dataZoom?: Array<{
          type?: string;
          xAxisIndex?: number;
          yAxisIndex?: number;
        }>;
      };
      const zooms = opt.dataZoom ?? [];
      const dzIdx = zooms.findIndex(
        (z) => z.type === 'inside' && z[axisKey as 'xAxisIndex' | 'yAxisIndex'] === 0,
      );
      if (dzIdx < 0) return null;

      // Use the axis's rendered extent (what the user actually sees) rather
      // than dataZoom.startValue/endValue. With `scale: true` on the y-axis,
      // ECharts pads the rendered range slightly beyond the dataZoom range
      // (e.g. visible [19.5, 21.3] when dataZoom maps 0-100% → [19.65, 21.17]).
      // On the very first dispatchAction that padding evaporates, and a 10%
      // zoom math step would look like a 25% visual jump. Anchoring on the
      // rendered extent makes every wheel notch shrink the visible window
      // by the same fraction, and dispatching with startValue/endValue then
      // sets the next rendered extent exactly.
      const axisModel = (chart as unknown as {
        getModel: () => {
          getComponent: (n: string, i: number) => {
            axis: { scale: { getExtent: () => [number, number] } };
          } | undefined;
        };
      }).getModel().getComponent(axis === 'y' ? 'yAxis' : 'xAxis', 0);
      const extent = axisModel?.axis.scale.getExtent();
      if (!extent || extent[1] === extent[0]) return null;
      const sv = extent[0];
      const ev = extent[1];
      const range = ev - sv;

      // Mouse fraction within the visible window. Clamp so cursors slightly
      // outside the grid anchor on the nearest edge rather than extrapolating.
      const fractionInView = Math.max(0, Math.min(1, (mouseDataVal - sv) / range));

      const newRange = Math.max(range * 0.005, range * factor); // floor at 0.5% of current
      const newSv = mouseDataVal - fractionInView * newRange;
      const newEv = newSv + newRange;
      return { startValue: newSv, endValue: newEv, index: dzIdx };
    };

    wheelHandler = (e: WheelEvent) => {
      if (!chart) return;
      e.preventDefault();

      // Mouse pixel → both axis data values. We don't gate on containPixel:
      // when the cursor is just above the grid (over the title or
      // record-temp pin) the handler should still fire; clamping inside
      // zoomAxis keeps the anchor sensible.
      const rect = chartRef!.getBoundingClientRect();
      const px = [e.clientX - rect.left, e.clientY - rect.top];
      const [mouseX, mouseY] = chart.convertFromPixel({ gridIndex: 0 }, px) as [number, number];

      // deltaY > 0 = scroll down = zoom out (factor > 1 = wider window).
      const factor = Math.exp(e.deltaY * ZOOM_PER_DELTA);

      // Dispatch x and y separately rather than batched: ECharts' batch
      // form silently drops the y-axis entry when an x-axis entry is also
      // present (verified experimentally — only the first entry applied).
      // Two dispatchActions in the same tick coalesce into a single redraw
      // anyway.
      const xz = zoomAxis('x', mouseX, factor);
      const yz = zoomAxis('y', mouseY, factor);
      if (xz) {
        chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: xz.index,
          startValue: xz.startValue,
          endValue: xz.endValue,
        });
      }
      if (yz) {
        chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: yz.index,
          startValue: yz.startValue,
          endValue: yz.endValue,
        });
      }
    };
    chartRef.addEventListener('wheel', wheelHandler, { capture: true, passive: false });

    // Listen at the renderer level. The chart-level 'click' fires through
    // ECharts' hit-testing, which struggles to register clicks on thin
    // lines even with `triggerLineEvent`, and the `inside` dataZoom can
    // interfere. zrender clicks fire on any canvas pixel; we map the pixel
    // to a (doy, value) coord and find the closest year ourselves.
    chart.getZr().on('click', (event) => {
      const c = chart;
      if (!c) return;
      const pixel = [event.offsetX, event.offsetY];
      if (!c.containPixel({ gridIndex: 0 }, pixel)) return;
      const [doy, val] = c.convertFromPixel({ gridIndex: 0 }, pixel) as [number, number];
      // Lines are 0.7–2 px thin but stack densely; a generous tolerance beats
      // requiring a sniper-shot click.
      const near = nearestLine(c, doy, val, 30);
      if (!near) return;
      setSelectedYear((curr) => (curr === near.year ? null : near.year));
    });

    // Hover-to-read: light up the nearest year-line, surface its value in the
    // corner readout, and drop a circle where the cursor's time crosses that
    // line. Throttled to one resolve per animation frame so a fast mouse drag
    // doesn't run nearestLine (a 44-series scan) per pixel.
    let pendingPixel: [number, number] | null = null;
    chart.getZr().on('mousemove', (event) => {
      pendingPixel = [event.offsetX, event.offsetY];
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const c = chart;
        const px = pendingPixel;
        if (!c || !px) return;
        if (!c.containPixel({ gridIndex: 0 }, px)) {
          clearHover();
          return;
        }
        const [doy, val] = c.convertFromPixel({ gridIndex: 0 }, px) as [number, number];
        const near = nearestLine(c, doy, val, 60);
        if (!near) {
          clearHover();
          return;
        }
        // Marker sits on the (vertical) cursor line, at the highlighted line's
        // value there — the exact point being read.
        const [mx, my] = c.convertToPixel({ gridIndex: 0 }, [doy, near.value]) as [number, number];
        marker?.attr({
          shape: { cx: mx, cy: my, r: 4.5 },
          style: { fill: near.color, stroke: themeColors?.text ?? '#fff', lineWidth: 1.5 },
        });
        marker?.show();
        setHover({ ...near, doy });
      });
    });
    chart.getZr().on('globalout', clearHover);
  });

  // Clear all hover affordances together (readout signal + marker).
  const clearHover = () => {
    setHover(null);
    marker?.hide();
  };

  // Reflect the hovered year onto the chart: emphasize that one line, downplay
  // the previously hovered one. Tracked outside the signal so we only dispatch
  // on an actual change, and so a full setOption (which wipes emphasis state)
  // can reset it.
  let highlightedYear: number | null = null;
  const applyHighlight = (year: number | null) => {
    const c = chart;
    if (!c || year === highlightedYear) return;
    if (highlightedYear !== null) c.dispatchAction({ type: 'downplay', seriesName: String(highlightedYear) });
    if (year !== null) c.dispatchAction({ type: 'highlight', seriesName: String(year) });
    highlightedYear = year;
  };
  createEffect(() => applyHighlight(hover()?.year ?? null));

  onCleanup(() => {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    if (wheelHandler && chartRef) {
      chartRef.removeEventListener('wheel', wheelHandler, { capture: true });
    }
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    chart?.dispose();
    chart = undefined;
  });

  // Re-render when payload, source, dataset, or theme changes. effectiveTheme is the
  // resolved 'light' | 'dark', so this also fires when the user switches the
  // pref or the OS theme changes (via applyTheme).
  createEffect(() => {
    const data = payload();
    const src = sourceKey();
    const ds = datasetKey();
    // Read effectiveTheme to take a reactive dependency on it; the colors
    // we then read via getComputedStyle reflect whichever data-theme the
    // applyTheme() effect has already written to <html>.
    appState.effectiveTheme;
    const sel = selectedYear();
    const layout = chartLayout();
    if (!chart || !data) return;
    const colors = readThemeColors();
    themeColors = colors; // cached for the hover marker's ring
    // A full re-render (replaceMerge) rebuilds every series, wiping any
    // emphasis state. Drop the stale hover so the readout, marker, and the
    // highlight-tracking ref don't point at a line that no longer exists.
    clearHover();
    highlightedYear = null;
    chart.setOption(buildOption(data, src, ds, colors, sel, chart, layout), true);
  });

  // Chart and grid are both mounted at all times (display-toggled by the
  // body[data-trends-mode] selector). When the user returns to single mode,
  // the chart container regains size and ECharts needs an explicit resize
  // pass — its measurements during display:none are zero.
  createEffect(() => {
    if (appState.trendsMode === 'single') {
      requestAnimationFrame(() => {
        chart?.resize();
        measureLayout();
      });
    }
  });

  // Mirror trendsMode onto <body> so the CSS can toggle which view is visible
  // without unmounting the chart instance.
  createEffect(() => {
    document.body.dataset.trendsMode = appState.trendsMode;
  });

  const onRegionChange = (e: Event & { currentTarget: HTMLSelectElement }) => {
    setAppState('region', e.currentTarget.value);
    saveState();
  };

  const setMode = (m: 'single' | 'grid') => {
    setAppState('trendsMode', m);
    saveState();
  };

  return (
    <div class="trends-tab">
      <Show when={appState.availableRegions.length > 1}>
        <div class="trends-header">
          <div class="trends-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              class={`trends-mode-btn ${appState.trendsMode === 'single' ? 'is-active' : ''}`}
              onClick={() => setMode('single')}
              aria-pressed={appState.trendsMode === 'single'}
            >
              Single
            </button>
            <button
              type="button"
              class={`trends-mode-btn ${appState.trendsMode === 'grid' ? 'is-active' : ''}`}
              onClick={() => setMode('grid')}
              aria-pressed={appState.trendsMode === 'grid'}
            >
              Grid
            </button>
          </div>
          <Show when={appState.trendsMode === 'single'}>
            <label for="trends-region-select">Region:</label>
            <select
              id="trends-region-select"
              class="trends-region-select"
              value={appState.region}
              onChange={onRegionChange}
            >
              <For each={appState.availableRegions}>
                {(r) => <option value={r}>{REGION_LABELS[r] ?? r}</option>}
              </For>
            </select>
          </Show>
        </div>
      </Show>
      {/* Single-mode chart — always mounted so the ECharts instance survives
          mode switches; CSS hides it when trendsMode === 'grid'. */}
      <div class="trends-single-view">
        <Show when={payload.error}>
          <div class="trends-error">
            Failed to load time-series data: {String(payload.error)}
          </div>
        </Show>
        <Show when={payload.loading}>
          <div class="trends-loading">Loading time-series…</div>
        </Show>
        <div ref={chartRef} class="trends-chart"></div>
        {/* Fixed corner readout for the hovered year — placed away from the
            cursor so it never covers the data the user is inspecting. */}
        <Show when={hover()}>
          {(h) => (
            <div class="trends-hover-readout">
              <span class="trends-hover-year" style={{ color: h().color }}>{h().year}</span>
              <span class="trends-hover-date">{dayLabel(h().doy)}</span>
              <span class="trends-hover-value">{h().value.toFixed(2)}°C</span>
            </div>
          )}
        </Show>
      </div>
      {/* Grid-mode small multiples — also always mounted. */}
      <Show when={appState.availableRegions.length > 1}>
        <div class="trends-grid-view">
          <TrendsGrid />
        </div>
      </Show>
      <div class="trends-footer">
        <Show
          when={appState.trendsMode === 'single'}
          fallback={
            <span>Click any region to expand. Use the Source, Variable and Anomaly toggles in the header to switch between OISST/ERA5, SST/2 m air temp, and raw vs. anomaly.</span>
          }
        >
          <span>Hover the chart to read the nearest year's value. Click any line to highlight
          that year (click again to clear). Drag the slider
          below the chart to zoom in time of year. Scroll inside the chart to zoom; shift-scroll
          to pan. Use the Source and Dataset toggles in the header to switch between OISST/ERA5
          and their available datasets.</span>
        </Show>
      </div>
    </div>
  );
};
