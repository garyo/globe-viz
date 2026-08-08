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
 * don't round to the same string. Reads the actual tick spacing from the
 * chart's y-axis scale — small-range data (anomalies) and tight zooms both
 * produce intervals like 0.05, where one decimal collapses neighboring
 * ticks into the same label ("0.8, 0.8"). Returns at least 1 decimal so
 * the label column width is stable on wide ranges.
 */
function yLabelDecimals(chart: echarts.ECharts | undefined): number {
  if (!chart) return 1;
  try {
    const axisModel = (chart as unknown as {
      getModel: () => {
        getComponent: (n: string, i: number) => {
          axis: { scale: { getTicks: () => Array<{ value: number }> } };
        } | undefined;
      };
    }).getModel().getComponent('yAxis', 0);
    const ticks = axisModel?.axis.scale.getTicks() ?? [];
    if (ticks.length < 2) return 1;
    // Use the smallest gap: the axis is pinned to the exact data extent, so
    // the first/last gap can be much narrower than the regular interval
    // (regular ticks …0.6, 0.75, then max at 0.83).
    let interval = Infinity;
    for (let i = 1; i < ticks.length; i++) {
      const gap = ticks[i].value - ticks[i - 1].value;
      if (gap > 1e-9 && gap < interval) interval = gap;
    }
    if (!Number.isFinite(interval)) return 1;
    // n decimals distinguish adjacent ticks iff interval >= 10^-n; the
    // 1.0001 factor absorbs float error (0.04999... is really 0.05).
    return Math.min(4, Math.max(1, Math.ceil(-Math.log10(interval * 1.0001))));
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

  const preliminaryFrom = payload.sources[source]?.preliminary_from;
  const years = groupByYear(series, preliminaryFrom);
  if (years.length === 0) {
    return { title: { text: 'No data', left: 'center', textStyle: { color: c.text } } };
  }

  const firstYear = years[0].year;
  const lastYear = years[years.length - 1].year;
  const yearRange = Math.max(1, lastYear - firstYear);
  const record = findRecord(years);

  const echartsSeries = years.flatMap((s) => {
    const t = (s.year - firstYear) / yearRange;
    let color = lerpHex(c.yearOld, c.yearRecent, t);
    let lineWidth = 0.7;
    let z = 1;
    if (s.year === lastYear) {
      color = c.yearCurrent;
      lineWidth = 2.5;
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
    const segment = (data: [number, number | null][], dotted: boolean) => ({
      name: String(s.year),
      type: 'line' as const,
      data,
      showSymbol: false,
      smooth: false,
      sampling: 'lttb' as const,
      lineStyle: { width: lineWidth, color, ...(dotted && { type: 'dotted' as const }) },
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
    });

    // ECharts can't dash part of one line series, so a year with provisional
    // data becomes two series that share everything but `lineStyle.type` — and
    // crucially share `name`, which several call sites key off. That's safe:
    // `legend.data` is an explicit list so no duplicate entry appears,
    // `nearestLine` reads `Number(s.name)` and gets the same year from either,
    // and highlight/downplay dispatch by name lights up both halves at once.
    // The dotted half starts one point early so the two visually join.
    const i = s.prelimIndex;
    if (i < 0) return [segment(s.data, false)];
    return [
      ...(i > 0 ? [segment(s.data.slice(0, i), false)] : []),
      segment(s.data.slice(Math.max(0, i - 1)), true),
    ];
  });

  const regionLabel = payload.region_label || REGION_LABELS[payload.region] || payload.region;
  // Every dataset is a temperature in °C; the unit rides in the title now that
  // the (redundant) y-axis name is gone.
  const title = narrow
    ? `${regionLabel} — ${DATASET_TITLE_SHORT[dataset]} (°C)`
    : `${regionLabel} — ${DATASET_TITLE_FRAGMENT[dataset]} (°C), ${firstYear}–${lastYear}`;

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
  // The *last* series for that year: when the year is split into solid + dotted
  // halves, the dotted tail is the one whose span contains the latest reading.
  const latestYearSeries = echartsSeries.filter((s) => s.name === String(lastYear)).pop();
  if (latestYearSeries) {
    const markData: Array<{
      coord: [number, number];
      label: { formatter: string; position?: string };
    }> = [];

    const latestYear = years[years.length - 1];
    const latestPoints = latestYear.data;
    let lastRealIdx = latestPoints.length - 1;
    while (lastRealIdx >= 0 && latestPoints[lastRealIdx][1] === null) lastRealIdx--;
    const lastReal =
      lastRealIdx >= 0 ? (latestPoints[lastRealIdx] as [number, number]) : undefined;
    // Flag the latest reading when it's still provisional — the dotted line says
    // so visually, but this label is what people actually read off the chart.
    const prelimNote =
      latestYear.prelimIndex >= 0 && lastRealIdx >= latestYear.prelimIndex
        ? ' (preliminary)'
        : '';

    // When the current year is at (or near) the all-time high, the record dot
    // and the latest-reading dot sit close together near the top and their
    // labels overlap into gibberish. Detect that and fan the labels to opposite
    // sides — the leftmost (earlier) dot points left, the other right — so both
    // stay readable. Proximity is measured against the data's y-extent so it's
    // independent of zoom level.
    let yMin = record ? record.value : 0;
    if (record) {
      for (const s of years) for (const [, v] of s.data) if (v !== null && v < yMin) yMin = v;
    }
    const yRange = record ? Math.max(1e-6, record.value - yMin) : 1;
    // The latest reading *is* the all-time record — one dot, one merged label
    // (two identical labels would just be noise).
    const latestIsRecord = !!record && !!lastReal && record.year === lastYear && record.doy === lastReal[0];
    const recordNearLatest =
      !latestIsRecord &&
      !!record &&
      !!lastReal &&
      Math.abs(record.doy - lastReal[0]) < 30 &&
      Math.abs(record.value - lastReal[1]) < yRange * 0.1;
    const recordIsLeft = !!record && !!lastReal && record.doy <= lastReal[0];

    if (record && latestIsRecord) {
      markData.push({
        coord: [record.doy, record.value],
        label: {
          formatter: `latest & record: ${dayLabel(record.doy)}, ${record.year}\n${record.value.toFixed(2)}°C${prelimNote}`,
          position: record.doy < 183 ? 'right' : 'left',
        },
      });
    } else {
      if (record) {
        markData.push({
          coord: [record.doy, record.value],
          label: {
            formatter: `record: ${dayLabel(record.doy)}, ${record.year}\n${record.value.toFixed(2)}°C`,
            // The record is the all-time max, so its dot always sits at the very
            // top of the plot — a label above it collides with the header band or
            // clips off the top edge. Tuck it beside the dot: away from the latest
            // reading when they collide, otherwise on whichever side has room.
            position: recordNearLatest ? (recordIsLeft ? 'left' : 'right') : record.doy < 183 ? 'right' : 'left',
          },
        });
      }

      if (lastReal) {
        const [doy, val] = lastReal;
        markData.push({
          coord: [doy, val],
          label: {
            formatter: `${dayLabel(doy)}, ${lastYear}\n${val.toFixed(2)}°C${prelimNote}`,
            // Opposite the record when they collide; otherwise inside the plot
            // (late-year points sit near the right edge, so flip left on narrow).
            position: recordNearLatest ? (recordIsLeft ? 'right' : 'left') : narrow ? 'left' : 'right',
          },
        });
      }
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
        : `Source: ${SOURCE_LABELS[source]} · area-weighted average · ${series.dates.length.toLocaleString()} daily values` +
          (preliminaryFrom ? ' · dotted = preliminary, subject to revision' : ''),
      left: 'center',
      textStyle: { color: c.text, fontSize: narrow ? 13 : 16 },
      subtextStyle: { color: c.subtitle, fontSize: 11 },
    },
    grid: {
      // Just enough for the y tick labels. Wide layouts used to leave extra
      // room for the (now removed) axis name; compact never had one.
      left: narrow ? 44 : 46,
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
      // No axis name: the centered title already spells out the dataset and
      // units, so an axis name would just duplicate it and eat left margin.
      axisLine: { lineStyle: { color: c.axis } },
      // Format labels with just enough precision to distinguish adjacent
      // ticks. At full zoom the y range is ~1.5°C and ticks are at 0.2°C
      // — 1 decimal works. When zoomed in tightly the interval drops to
      // 0.05 or 0.01 and 1 decimal collapses neighboring ticks into the
      // same string ("20.2, 20.2, 20.3, 20.3"), and anomaly data has a
      // small range at full zoom too. yLabelDecimals reads the actual
      // tick spacing and picks an interval-appropriate precision.
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
      // Native wheel and pinch zoom both disabled — we handle them ourselves so
      // we can tame sensitivity and anchor the zoom on the cursor/fingers.
      // moveOnMouseMove (drag-to-pan) stays enabled.
      //
      // zoomLock is what unregisters the pinch: it downgrades the roam
      // controller to 'move' (echarts/component/dataZoom/roams.js), which
      // leaves the drag-to-pan listeners attached but drops the pinch one.
      // It does not constrain us — zoomLock is documented as an interaction
      // constraint only, and dispatchAction still resizes the window freely
      // (see the comment in echarts/component/dataZoom/AxisProxy.js).
      //
      // filterMode 'none' on every zoom that touches an axis. ECharts defaults
      // to 'filter', which physically removes out-of-window points from the
      // series rather than just narrowing the axis — so the segment joining the
      // last visible point to its off-screen neighbour has no endpoint left to
      // draw to and every line stops short of the edge. On the y zoom it is
      // worse than cosmetic: a line dipping below the window loses those points
      // and is redrawn straight across the gap, which misstates the data.
      // 'none' moves the window only; series clip:true still clips at the grid.
      {
        type: 'inside',
        xAxisIndex: 0,
        zoomOnMouseWheel: false,
        moveOnMouseWheel: false,
        zoomLock: true,
        filterMode: 'none',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: compact ? 14 : 20,
        bottom: compact ? 6 : 30,
        textStyle: { color: c.text },
        borderColor: c.axis,
        fillerColor: c.grid,
        backgroundColor: 'transparent',
      },
      {
        type: 'inside',
        yAxisIndex: 0,
        zoomOnMouseWheel: false,
        moveOnMouseWheel: false,
        zoomLock: true,
        filterMode: 'none',
      },
    ],
    // compact: a single legend row under the title, where it can't cover the
    // data. Otherwise a floating box at the lower-left of the plot, clear of
    // the Datasets panel that pops open over the lower-right.
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
          left: 56,
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
  let cursorHandler: ((e: MouseEvent) => void) | undefined;
  let pinchMoveHandler: ((e: TouchEvent) => void) | undefined;
  let pinchEndHandler: ((e: TouchEvent) => void) | undefined;
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

    // The inside dataZoom index for an axis, plus the window it currently
    // renders, in axis-value space.
    //
    // The extent comes from the axis's rendered scale (what the user actually
    // sees) rather than dataZoom.startValue/endValue. With `scale: true` on the
    // y-axis, ECharts pads the rendered range slightly beyond the dataZoom range
    // (e.g. visible [19.5, 21.3] when dataZoom maps 0-100% → [19.65, 21.17]).
    // On the very first dispatchAction that padding evaporates, and a 10% zoom
    // math step would look like a 25% visual jump. Anchoring on the rendered
    // extent makes every step shrink the visible window by the same fraction,
    // and dispatching with startValue/endValue then sets the next rendered
    // extent exactly.
    const axisWindow = (
      axis: 'x' | 'y',
    ): { index: number; sv: number; ev: number } | null => {
      if (!chart) return null;
      const axisKey = axis === 'y' ? 'yAxisIndex' : 'xAxisIndex';
      const opt = chart.getOption() as {
        dataZoom?: Array<{
          type?: string;
          xAxisIndex?: number;
          yAxisIndex?: number;
        }>;
      };
      const index = (opt.dataZoom ?? []).findIndex(
        (z) => z.type === 'inside' && z[axisKey] === 0,
      );
      if (index < 0) return null;

      const axisModel = (chart as unknown as {
        getModel: () => {
          getComponent: (n: string, i: number) => {
            axis: { scale: { getExtent: () => [number, number] } };
          } | undefined;
        };
      }).getModel().getComponent(axis === 'y' ? 'yAxis' : 'xAxis', 0);
      const extent = axisModel?.axis.scale.getExtent();
      if (!extent || extent[1] === extent[0]) return null;
      return { index, sv: extent[0], ev: extent[1] };
    };

    // Pixel coordinate of a value along its own axis. The current window's
    // endpoints map to the grid's edges, which is how the pinch solver below
    // recovers the grid geometry without digging into the layout.
    const pixelOfValue = (axis: 'x' | 'y', v: number): number => {
      const px = chart!.convertToPixel(
        { gridIndex: 0 },
        axis === 'x' ? [v, 0] : [0, v],
      ) as [number, number];
      return axis === 'x' ? px[0] : px[1];
    };

    const zoomAxis = (
      axis: 'x' | 'y',
      mouseDataVal: number,
      factor: number,
    ): { startValue: number; endValue: number; index: number } | null => {
      const w = axisWindow(axis);
      if (!w) return null;
      const { sv, ev, index: dzIdx } = w;
      const range = ev - sv;

      // Mouse fraction within the visible window. Clamp so cursors slightly
      // outside the grid anchor on the nearest edge rather than extrapolating.
      const fractionInView = Math.max(0, Math.min(1, (mouseDataVal - sv) / range));

      const newRange = Math.max(range * 0.005, range * factor); // floor at 0.5% of current
      const newSv = mouseDataVal - fractionInView * newRange;
      const newEv = newSv + newRange;
      return { startValue: newSv, endValue: newEv, index: dzIdx };
    };

    // Slide the visible time-window left/right by a wheel pixel delta without
    // changing its width. The x-axis is a fixed 0..365 leap-aligned day-of-year
    // span, so the panned window is clamped inside that, edge-aligned, rather
    // than letting ECharts clamp each endpoint independently (which would
    // shrink the window at the boundary).
    const X_AXIS_MIN = 0;
    const X_AXIS_MAX = 365;
    const panAxisX = (
      deltaPx: number,
    ): { startValue: number; endValue: number; index: number } | null => {
      if (!chart) return null;
      const w = axisWindow('x');
      if (!w) return null;
      const { sv, ev, index: dzIdx } = w;
      const range = ev - sv;

      // Pixel delta → data delta so a notch pans the content 1:1 with the wheel.
      const gridPxWidth = Math.abs(pixelOfValue('x', ev) - pixelOfValue('x', sv)) || 1;
      const deltaData = (deltaPx / gridPxWidth) * range;

      let nsv = sv + deltaData;
      let nev = ev + deltaData;
      if (nsv < X_AXIS_MIN) {
        nsv = X_AXIS_MIN;
        nev = X_AXIS_MIN + range;
      } else if (nev > X_AXIS_MAX) {
        nev = X_AXIS_MAX;
        nsv = X_AXIS_MAX - range;
      }
      return { startValue: nsv, endValue: nev, index: dzIdx };
    };

    wheelHandler = (e: WheelEvent) => {
      if (!chart) return;
      e.preventDefault();

      // Pan the time axis instead of zooming when shift is held (browsers
      // remap shift+wheel to a horizontal delta, though some still report it on
      // deltaY) or when the device sends a dominant horizontal delta — a
      // side-scroll wheel or a two-finger horizontal trackpad swipe.
      const horizontalDelta = e.shiftKey ? (e.deltaX !== 0 ? e.deltaX : e.deltaY) : e.deltaX;
      if (horizontalDelta !== 0 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        const pan = panAxisX(horizontalDelta);
        if (pan) {
          chart.dispatchAction({
            type: 'dataZoom',
            dataZoomIndex: pan.index,
            startValue: pan.startValue,
            endValue: pan.endValue,
          });
        }
        return;
      }

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

    // Two-finger zoom. ECharts' own pinch is unusable at any real zoom level:
    // RoamController throws the pinch magnitude away and applies a flat ±10%
    // per touchmove event (`scale = e.pinchScale > 1 ? 1.1 : 1/1.1`), so a
    // half-second of finger drift compounds to 1.1^30 ≈ 17×. It is disabled
    // via zoomLock on the inside zooms; this replaces it.
    //
    // We solve instead for the window that keeps the data under each finger
    // pinned to that finger. Independent x and y zooms make that exactly
    // determined: two fingers give four pixel coordinates, and the two windows
    // have four unknowns (a scale and an offset each). Panning is not a
    // separate mode — fingers moving together leave the scales untouched and
    // the offsets follow, so the content simply tracks the gesture.
    //
    // Everything is measured against values captured at gesture start rather
    // than accumulated frame to frame, so a frame that ECharts clamps (at the
    // data edge, or against the zoom limit below) cannot drift: reverse the
    // gesture and the content comes back under the fingers exactly.
    const PINCH_MIN_SEP_PX = 36; // below this an axis can't be scaled meaningfully
    const PINCH_MAX_GESTURE_ZOOM = 20; // bound on one gesture's total scale change

    type PinchAnchor = {
      ids: [number, number];
      px: [number, number]; // finger pixels at gesture start
      py: [number, number];
      dx: [number, number]; // data values under those pixels at gesture start
      dy: [number, number];
      xRange: number; // window widths at gesture start
      yRange: number;
    };
    let pinch: PinchAnchor | undefined;

    // Rect is passed in, not re-read per finger: this runs on every touchmove
    // frame and getBoundingClientRect forces layout.
    const fingerPixels = (t: Touch, rect: DOMRect): [number, number] => [
      t.clientX - rect.left,
      t.clientY - rect.top,
    ];

    const capturePinch = (a: Touch, b: Touch, rect: DOMRect) => {
      pinch = undefined;
      if (!chart) return;
      const xw = axisWindow('x');
      const yw = axisWindow('y');
      if (!xw || !yw) return;
      const pa = fingerPixels(a, rect);
      const pb = fingerPixels(b, rect);
      const da = chart.convertFromPixel({ gridIndex: 0 }, pa) as [number, number];
      const db = chart.convertFromPixel({ gridIndex: 0 }, pb) as [number, number];
      pinch = {
        ids: [a.identifier, b.identifier],
        px: [pa[0], pb[0]],
        py: [pa[1], pb[1]],
        dx: [da[0], db[0]],
        dy: [da[1], db[1]],
        xRange: xw.ev - xw.sv,
        yRange: yw.ev - yw.sv,
      };
    };

    // Window that puts the anchor values back under the fingers now holding
    // them. The axis maps linearly onto a fixed pixel span, so with g0 = the
    // pixel of the window start and gSpan = the pixel of the window end minus
    // g0 (negative on y, which grows downward — the algebra is sign-agnostic):
    //     range = (a1 - a0) * gSpan / (q1 - q0)
    //
    // Fingers close together *along this axis* drive that denominator toward
    // zero and the range toward infinity, which is the runaway to avoid: a
    // near-vertical pinch says almost nothing about the horizontal scale.
    // Under PINCH_MIN_SEP_PX we hold the width from gesture start and pin the
    // midpoint instead, so a vertical pinch reads as "zoom y, pan x".
    const solvePinchAxis = (
      axis: 'x' | 'y',
      [a0, a1]: [number, number],
      [p0, p1]: [number, number],
      q0: number,
      q1: number,
      startRange: number,
    ): { startValue: number; endValue: number; index: number } | null => {
      const w = axisWindow(axis);
      if (!w) return null;
      const g0 = pixelOfValue(axis, w.sv);
      const gSpan = pixelOfValue(axis, w.ev) - g0;
      if (!gSpan) return null;

      const scalable =
        Math.abs(q1 - q0) >= PINCH_MIN_SEP_PX && Math.abs(p1 - p0) >= PINCH_MIN_SEP_PX;
      // abs(): if the fingers cross over on this axis the raw range flips sign,
      // which would mirror the axis. Clamping the magnitude keeps it sane.
      const raw = scalable ? Math.abs(((a1 - a0) * gSpan) / (q1 - q0)) : startRange;
      const range = Math.min(
        Math.max(raw, startRange / PINCH_MAX_GESTURE_ZOOM),
        startRange * PINCH_MAX_GESTURE_ZOOM,
      );

      const anchorVal = scalable ? a0 : (a0 + a1) / 2;
      const anchorPx = scalable ? q0 : (q0 + q1) / 2;
      const sv = anchorVal - ((anchorPx - g0) / gSpan) * range;
      return { startValue: sv, endValue: sv + range, index: w.index };
    };

    pinchMoveHandler = (e: TouchEvent) => {
      if (!chart) return;

      if (e.touches.length < 2) {
        // Tail of a pinch, one finger still down. zrender's drag origin is
        // stale — its pan bails out on every frame the gesture was recognized
        // as a pinch, so it never tracked those moves — and letting this
        // through would jump the view by the accumulated difference. Swallow
        // until every finger lifts.
        if (pinch) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      const a = e.touches[0];
      const b = e.touches[1];
      const rect = chartRef!.getBoundingClientRect();
      if (!pinch || pinch.ids[0] !== a.identifier || pinch.ids[1] !== b.identifier) {
        capturePinch(a, b, rect); // first frame, or a finger was added/lifted
      }
      if (!pinch) return;
      e.preventDefault();

      const qa = fingerPixels(a, rect);
      const qb = fingerPixels(b, rect);
      const xz = solvePinchAxis('x', pinch.dx, pinch.px, qa[0], qb[0], pinch.xRange);
      const yz = solvePinchAxis('y', pinch.dy, pinch.py, qa[1], qb[1], pinch.yRange);
      // Dispatched separately, not batched — see the wheel handler's note.
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

    pinchEndHandler = (e: TouchEvent) => {
      if (e.touches.length === 0) pinch = undefined;
    };

    chartRef.addEventListener('touchmove', pinchMoveHandler, { capture: true, passive: false });
    chartRef.addEventListener('touchend', pinchEndHandler);
    chartRef.addEventListener('touchcancel', pinchEndHandler);

    // Hide the native cursor only over the plot grid (the dashed crosshair
    // stands in for it there, so it never covers the point being read). The
    // dataZoom slider shares the same canvas, so a blanket CSS `cursor: none`
    // would hide the cursor over the slider too and make it unusable. This
    // listener runs after zrender's own mousemove handler (registered first,
    // during init), so off-grid it leaves zrender's cursor — the slider's
    // resize/grab affordances — untouched. We override zrender's own viewport
    // root (the canvas layers' shared parent, the element zrender writes its
    // cursor onto); writing to the outer container or getZr().dom instead is
    // shadowed by that inner cursor and has no effect over the canvas.
    const zrRoot = chart.getZr().painter.getViewportRoot();
    cursorHandler = (e: MouseEvent) => {
      if (!chart || !chartRef || !zrRoot) return;
      const rect = chartRef.getBoundingClientRect();
      const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      if (chart.containPixel({ gridIndex: 0 }, px)) {
        zrRoot.style.cursor = 'none';
      }
    };
    chartRef.addEventListener('mousemove', cursorHandler);

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
      const [rawDoy, val] = c.convertFromPixel({ gridIndex: 0 }, pixel) as [number, number];
      const doy = Math.round(rawDoy); // snap to nearest day; see hover resolver below
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
        const [rawDoy, val] = c.convertFromPixel({ gridIndex: 0 }, px) as [number, number];
        // Snap to the nearest whole day so the readout label, marker and
        // highlighted line all key off one date. Without this, a pointer a
        // fraction of a day past the latest year's final point (e.g. just
        // right of Jun 28) falls outside that year's last segment and the
        // "nearest line" jumps to whichever year still has data at the
        // fractional day — while the label, rounding the same fraction down,
        // still reads Jun 28.
        const doy = Math.round(rawDoy);
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
    if (cursorHandler && chartRef) {
      chartRef.removeEventListener('mousemove', cursorHandler);
    }
    if (pinchMoveHandler && chartRef) {
      chartRef.removeEventListener('touchmove', pinchMoveHandler, { capture: true });
    }
    if (pinchEndHandler && chartRef) {
      chartRef.removeEventListener('touchend', pinchEndHandler);
      chartRef.removeEventListener('touchcancel', pinchEndHandler);
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
          to pan; pinch to zoom and pan together on a touchscreen. Use the Source and Dataset
          toggles in the header to switch between OISST/ERA5 and their available datasets.</span>
        </Show>
      </div>
    </div>
  );
};
