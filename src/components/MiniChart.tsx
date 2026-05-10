import { createEffect, onMount, onCleanup } from 'solid-js';
import {
  type DatasetSeries,
  type ThemeColors,
  groupByYear,
  lerpHex,
} from '../lib/timeseriesUtils';

interface MiniChartProps {
  series: DatasetSeries;
  colors: ThemeColors;
}

// Tiny canvas-based year-spaghetti renderer for the grid view. Hand-drawn
// rather than instantiating a full ECharts per cell because:
//   - 10 ECharts instances at 16K points × 44 years each is heavy
//   - thumbnails don't need tooltips, zoom, legends, axis labels
//   - draw cost here is a single ~50ms canvas pass on mount + theme/dataset
//     change; resize is the same cost
//
// Visual: every year drawn as a polyline using the same yearOld→yearRecent
// gradient as the main chart, with the current year drawn last in red on top.
// Y-range is auto-fit per cell (regions span very different absolute values).
export const MiniChart = (props: MiniChartProps) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const draw = () => {
    if (!canvasRef) return;
    const parent = canvasRef.parentElement;
    if (!parent) return;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = Math.round(cssW * dpr);
    canvasRef.height = Math.round(cssH * dpr);
    canvasRef.style.width = cssW + 'px';
    canvasRef.style.height = cssH + 'px';

    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const years = groupByYear(props.series);
    if (years.length === 0) return;

    // Compute y-range from finite values across all years.
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of years) {
      for (const [, v] of s.data) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) return;
    const yPad = (yMax - yMin) * 0.05 || 0.5;
    yMin -= yPad;
    yMax += yPad;

    // Inset so strokes don't clip at the edges.
    const padL = 4, padR = 4, padT = 6, padB = 6;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    if (plotW <= 0 || plotH <= 0) return;

    const xToPx = (doy: number) => padL + (doy / 365) * plotW;
    const yToPx = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    const firstYear = years[0].year;
    const lastYear = years[years.length - 1].year;
    const yearRange = Math.max(1, lastYear - firstYear);

    const drawYear = (s: typeof years[number], color: string, lineWidth: number) => {
      if (s.data.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(xToPx(s.data[0][0]), yToPx(s.data[0][1]));
      for (let i = 1; i < s.data.length; i++) {
        ctx.lineTo(xToPx(s.data[i][0]), yToPx(s.data[i][1]));
      }
      ctx.stroke();
    };

    // Older years first (gradient old → recent), then the highlighted years
    // back-to-front so current sits on top — mirrors the main chart's
    // emphasis stack: prev-2 (green), prev (orange), current (red).
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const isHighlighted = (yr: number) =>
      yr === lastYear || yr === lastYear - 1 || yr === lastYear - 2;

    for (const s of years) {
      if (isHighlighted(s.year)) continue;
      const t = (s.year - firstYear) / yearRange;
      drawYear(s, lerpHex(props.colors.yearOld, props.colors.yearRecent, t), 0.6);
    }

    const drawIfPresent = (yr: number, color: string, width: number) => {
      const s = years.find((x) => x.year === yr);
      if (s) drawYear(s, color, width);
    };
    drawIfPresent(lastYear - 2, props.colors.yearPrev2, 1.0);
    drawIfPresent(lastYear - 1, props.colors.yearPrev, 1.3);
    drawIfPresent(lastYear, props.colors.yearCurrent, 1.8);
  };

  onMount(() => {
    draw();
    if (canvasRef?.parentElement && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => draw());
      resizeObserver.observe(canvasRef.parentElement);
    }
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
  });

  // Re-paint whenever inputs change.
  createEffect(() => {
    props.series;
    props.colors;
    draw();
  });

  return <canvas ref={canvasRef} class="mini-chart-canvas"></canvas>;
};
