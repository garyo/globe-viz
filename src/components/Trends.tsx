import { Show, createEffect, createResource, onCleanup, onMount } from 'solid-js';
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
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { appState } from '../stores/appState';
import { fetchTimeseries, type TimeseriesPayload } from '../lib/data/timeseries';

echarts.use([
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

type SourceDataset = 'sst' | 'anom';

// Days-before-month index for a leap year. Used to align all years' day-of-year
// onto a common 0..365 axis so non-leap and leap years overlay cleanly,
// matching ymd_to_year_day_for_graph() in sea-surface-temps.py.
const LEAP_DAYS_BEFORE_MONTH = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

function leapAlignedDayOfYear(dateStr: string): number {
  const [, m, d] = dateStr.split('-').map(Number);
  return LEAP_DAYS_BEFORE_MONTH[m - 1] + d - 1;
}

// Day-of-year (leap-aligned) → "Mon D" label
function dayLabel(doy: number): string {
  const refStart = Date.UTC(2000, 0, 1); // 2000 is a leap year
  const date = new Date(refStart + doy * 86400000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Linear interpolation between two color stops in the sRGB-ish color space
// of CSS hex notation (good enough for our gradient).
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHex(c: string): [number, number, number] {
  const h = c.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

interface ThemeColors {
  yearOld: string;
  yearRecent: string;
  yearCurrent: string;
  yearPrev: string;
  yearPrev2: string;
  yearRecord: string;
  axis: string;
  grid: string;
  text: string;
  subtitle: string;
  tooltipBg: string;
  tooltipBorder: string;
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readThemeColors(): ThemeColors {
  return {
    yearOld: readVar('--year-old', '#cccccc'),
    yearRecent: readVar('--year-recent', '#1a3a96'),
    yearCurrent: readVar('--year-current', '#d92020'),
    yearPrev: readVar('--year-prev', '#c66400'),
    yearPrev2: readVar('--year-prev2', '#1f7a3a'),
    yearRecord: readVar('--year-record', '#000000'),
    axis: readVar('--chart-axis', 'rgba(0,0,0,0.4)'),
    grid: readVar('--chart-grid', 'rgba(0,0,0,0.08)'),
    text: readVar('--chart-text', 'rgba(0,0,0,0.8)'),
    subtitle: readVar('--chart-subtitle', 'rgba(0,0,0,0.55)'),
    tooltipBg: readVar('--chart-tooltip-bg', 'rgba(255,255,255,0.96)'),
    tooltipBorder: readVar('--chart-tooltip-border', 'rgba(0,0,0,0.18)'),
  };
}

interface YearSeries {
  year: number;
  data: [number, number][]; // [day-of-year, value]
}

function groupByYear(series: { dates: string[]; values: number[] }): YearSeries[] {
  const byYear = new Map<number, [number, number][]>();
  for (let i = 0; i < series.dates.length; i++) {
    const date = series.dates[i];
    const value = series.values[i];
    if (!Number.isFinite(value)) continue;
    const year = Number(date.slice(0, 4));
    const doy = leapAlignedDayOfYear(date);
    const arr = byYear.get(year) ?? [];
    arr.push([doy, value]);
    byYear.set(year, arr);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, data]) => ({ year, data: data.sort((p, q) => p[0] - q[0]) }));
}

function findRecord(yearsSeries: YearSeries[]): { year: number; doy: number; value: number } | null {
  let best: { year: number; doy: number; value: number } | null = null;
  for (const s of yearsSeries) {
    for (const [doy, v] of s.data) {
      if (best === null || v > best.value) best = { year: s.year, doy, value: v };
    }
  }
  return best;
}

function buildOption(
  payload: TimeseriesPayload,
  dataset: SourceDataset,
  c: ThemeColors,
): EChartsOption {
  const series = payload.sources.oisst?.datasets[dataset];
  if (!series) {
    return { title: { text: 'No data', left: 'center', textStyle: { color: c.text } } };
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
      // Disable hover-emphasis. With 44 series, ECharts otherwise repaints
      // all 43 non-hovered lines (fading them) every time the mouse crosses
      // a new series — the source of the perceived flicker on mouse move.
      emphasis: { disabled: true },
    };
  });

  const datasetLabel = dataset === 'sst' ? 'SST (°C)' : 'Anomaly vs. 1971–2000 mean (°C)';
  const title =
    dataset === 'sst'
      ? `Global Sea Surface Temperature, ${firstYear}–${lastYear}`
      : `Global Sea Surface Temp Anomaly vs. 1971–2000 mean, ${firstYear}–${lastYear}`;

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
          position: 'top',
        },
      });
    }

    const latestPoints = years[years.length - 1].data;
    if (latestPoints.length > 0) {
      const [doy, val] = latestPoints[latestPoints.length - 1];
      markData.push({
        coord: [doy, val],
        label: {
          formatter: `${dayLabel(doy)}, ${lastYear}\n${val.toFixed(2)}°C`,
          position: 'right',
        },
      });
    }

    if (markData.length > 0) {
      (latestYearSeries as { markPoint?: unknown }).markPoint = {
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: c.yearRecord, borderColor: c.text, borderWidth: 1 },
        label: { color: c.text, fontSize: 11 },
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
      subtext: `Source: NOAA OISST · weighted avg 60°S–60°N · ${series.dates.length.toLocaleString()} daily values`,
      left: 'center',
      textStyle: { color: c.text, fontSize: 16 },
      subtextStyle: { color: c.subtitle, fontSize: 11 },
    },
    grid: { left: 60, right: 30, top: 70, bottom: 80 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.text },
      transitionDuration: 0,
      confine: true,
      axisPointer: { type: 'line', lineStyle: { color: c.axis } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: [number, number]; color: string }>;
        if (!arr.length) return '';
        const doy = arr[0].value[0];
        const lines = [`<b>${dayLabel(doy)}</b>`];
        const sorted = [...arr].sort((a, b) => b.value[1] - a.value[1]);
        for (const p of sorted.slice(0, 6)) {
          lines.push(
            `<span style="display:inline-block;width:8px;height:8px;background:${p.color};border-radius:50%;margin-right:6px"></span>${p.seriesName}: <b>${p.value[1].toFixed(3)}°C</b>`,
          );
        }
        if (arr.length > 6) lines.push(`… and ${arr.length - 6} more years`);
        return lines.join('<br>');
      },
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
    },
    yAxis: {
      type: 'value',
      name: datasetLabel,
      nameTextStyle: { color: c.text },
      axisLine: { lineStyle: { color: c.axis } },
      axisLabel: { color: c.text },
      splitLine: { lineStyle: { color: c.grid } },
      scale: true,
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 20,
        bottom: 30,
        textStyle: { color: c.text },
        borderColor: c.axis,
        fillerColor: c.grid,
        backgroundColor: 'transparent',
      },
      { type: 'inside', yAxisIndex: 0 },
    ],
    legend: {
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

  // Phase 1: only the global region exists on S3.
  const region = () => 'global';

  const [payload] = createResource(region, fetchTimeseries);

  const datasetKey = (): SourceDataset =>
    appState.dataset === 'Temperature' ? 'sst' : 'anom';

  onMount(() => {
    if (!chartRef) return;
    chart = echarts.init(chartRef, undefined, { renderer: 'canvas' });
    resizeHandler = () => chart?.resize();
    window.addEventListener('resize', resizeHandler);
  });

  onCleanup(() => {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    chart?.dispose();
    chart = undefined;
  });

  // Re-render when payload, dataset, or theme changes. effectiveTheme is the
  // resolved 'light' | 'dark', so this also fires when the user switches the
  // pref or the OS theme changes (via applyTheme).
  createEffect(() => {
    const data = payload();
    const ds = datasetKey();
    // Read effectiveTheme to take a reactive dependency on it; the colors
    // we then read via getComputedStyle reflect whichever data-theme the
    // applyTheme() effect has already written to <html>.
    appState.effectiveTheme;
    if (!chart || !data) return;
    const colors = readThemeColors();
    chart.setOption(buildOption(data, ds, colors), true);
  });

  return (
    <div class="trends-tab">
      <Show when={payload.error}>
        <div class="trends-error">
          Failed to load time-series data: {String(payload.error)}
        </div>
      </Show>
      <Show when={payload.loading}>
        <div class="trends-loading">Loading time-series…</div>
      </Show>
      <div ref={chartRef} class="trends-chart"></div>
      <div class="trends-footer">
        Drag the slider below the chart to zoom in time of year. Scroll inside the chart
        to zoom; shift-scroll to pan. Use the Dataset toggle in the header to switch
        between Temperature and Anomaly.
      </div>
    </div>
  );
};
