import { For, Show, createEffect, createResource, onCleanup, onMount } from 'solid-js';
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
import { appState, setAppState, saveState } from '../stores/appState';
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
  CanvasRenderer,
]);

type SourceDataset = 'sst' | 'anom';

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
  const regionLabel = payload.region_label || REGION_LABELS[payload.region] || payload.region;
  const title =
    dataset === 'sst'
      ? `${regionLabel} — Sea Surface Temperature, ${firstYear}–${lastYear}`
      : `${regionLabel} — SST Anomaly vs. 1971–2000 mean, ${firstYear}–${lastYear}`;

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
      subtext: `Source: NOAA OISST · area-weighted average · ${series.dates.length.toLocaleString()} daily values`,
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

  // Track the current region from appState so the resource refetches whenever
  // the user changes the selection.
  const region = () => appState.region;

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

  // Chart and grid are both mounted at all times (display-toggled by the
  // body[data-trends-mode] selector). When the user returns to single mode,
  // the chart container regains size and ECharts needs an explicit resize
  // pass — its measurements during display:none are zero.
  createEffect(() => {
    if (appState.trendsMode === 'single') {
      requestAnimationFrame(() => chart?.resize());
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
            <span>Click any region to expand. Use the Dataset toggle in the header to switch between Temperature and Anomaly.</span>
          }
        >
          <span>Drag the slider below the chart to zoom in time of year. Scroll inside the chart
          to zoom; shift-scroll to pan. Use the Dataset toggle in the header to switch
          between Temperature and Anomaly.</span>
        </Show>
      </div>
    </div>
  );
};
