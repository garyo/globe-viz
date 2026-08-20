/**
 * Burned-in info band for exported movies: source name, the animation cycle's
 * date range, the color legend (with units), and a large ticking current
 * date. Drawn with Canvas 2D over the composited globe frame.
 *
 * Colors are fixed dark-on-light — the movie background is always the app's
 * theme-independent light gradient, so the overlay must not follow the
 * viewer's app theme (no CSS variables here).
 */
import * as d3 from 'd3';
import qrcode from 'qrcode-generator';
import type { ColormapConfig } from '../data/colormap';
import { formatDate } from '../helpers/dates';

export interface OverlaySpec {
  /** Full source name, e.g. "NOAA OISST". */
  sourceName: string;
  /** Legend config; its title already carries the dataset + units. */
  legend: ColormapConfig | null;
  startDate: string;
  endDate: string;
  /** Attribution line drawn small along the bottom edge of the band. */
  credit: string;
  /** Pre-rendered QR badge (createQrCanvas) drawn in the top-right corner. */
  qrCanvas: HTMLCanvasElement | null;
}

/** Height of the info band at 1080p; scales with output height. */
export const OVERLAY_BAND_PX = 150;

/**
 * Render `url` as a QR badge on its own small canvas: a two-line "Open in /
 * Globe Viz" header above the code, all on one white patch. The code is sized
 * to roughly `targetPx` but snapped to a whole number of pixels per module so
 * it stays crisp when drawn 1:1. Includes the spec's 4-module quiet zone.
 */
export function createQrCanvas(url: string, targetPx: number): HTMLCanvasElement {
  const qr = qrcode(0, 'M'); // type 0 = auto-size to the data
  qr.addData(url);
  qr.make();
  const modules = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(2, Math.round(targetPx / (modules + 2 * quiet)));
  const size = cell * (modules + 2 * quiet);
  const headerH = Math.round(size * 0.32);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = headerH + size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);

  g.textAlign = 'center';
  g.fillStyle = '#333333';
  g.font = `${Math.round(size * 0.11)}px system-ui, sans-serif`;
  g.fillText('Open in', size / 2, headerH * 0.45);
  g.fillStyle = '#111111';
  g.font = `bold ${Math.round(size * 0.13)}px system-ui, sans-serif`;
  g.fillText('Globe Viz', size / 2, headerH * 0.95);

  g.fillStyle = '#000000';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        g.fillRect((quiet + col) * cell, headerH + (quiet + row) * cell, cell, cell);
      }
    }
  }
  return canvas;
}

/** Movie date format: like formatDate but with a zero-padded day, so with a
 * monospace face every date in the cycle renders at the same width — no
 * jitter as the animation ticks. */
function formatDateFixed(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}

const DATE_FONT = (s: number) =>
  `bold ${30 * s}px ui-monospace, 'SF Mono', Menlo, monospace`;

export function drawOverlay(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: OverlaySpec,
  currentDate: string,
  /** Position within the cycle, 0..1 — drives the little progress bar. */
  progress: number,
): void {
  const s = h / 1080;
  const band = OVERLAY_BAND_PX * s;
  const top = h - band;

  // Band background with a hairline top border.
  g.fillStyle = 'rgba(255, 255, 255, 0.88)';
  g.fillRect(0, top, w, band);
  g.fillStyle = 'rgba(0, 0, 0, 0.15)';
  g.fillRect(0, top, w, 1 * s);

  const margin = 28 * s;

  // Left: source name + the cycle's date range.
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#1a1a1a';
  g.font = `bold ${30 * s}px system-ui, sans-serif`;
  g.fillText(spec.sourceName, margin, top + 58 * s);
  g.fillStyle = '#444444';
  g.font = `${22 * s}px system-ui, sans-serif`;
  g.fillText(
    `${formatDate(spec.startDate)} – ${formatDate(spec.endDate)}`,
    margin,
    top + 98 * s,
  );

  // Right: the current frame's date, large, in a monospace face with a
  // padded day so its width is identical on every frame, plus a small
  // progress bar locating this frame within the cycle.
  g.textAlign = 'right';
  g.fillStyle = '#666666';
  g.font = `${16 * s}px system-ui, sans-serif`;
  g.fillText('Date', w - margin, top + 38 * s);
  g.fillStyle = '#111111';
  g.font = DATE_FONT(s);
  g.fillText(formatDateFixed(currentDate), w - margin, top + 78 * s);

  const barW = g.measureText(formatDateFixed(currentDate)).width;
  const barH = 5 * s;
  const barX = w - margin - barW;
  const barY = top + 92 * s;
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  g.fillRect(barX, barY, barW, barH);
  g.fillStyle = '#4a86c8';
  g.fillRect(barX, barY, barW * Math.max(0, Math.min(1, progress)), barH);

  if (spec.legend) drawLegend(g, w, top, s, spec.legend);

  // Attribution, small and centered along the band's bottom edge.
  g.textAlign = 'center';
  g.fillStyle = '#777777';
  g.font = `${15 * s}px system-ui, sans-serif`;
  g.fillText(spec.credit, w / 2, top + band - 12 * s);

  // QR badge in the frame's top-right corner (its own quiet zone is baked in;
  // draw 1:1 so the modules stay pixel-crisp).
  if (spec.qrCanvas) {
    const inset = 16 * s;
    g.drawImage(spec.qrCanvas, w - spec.qrCanvas.width - inset, inset);
  }
}

/** Discrete swatch legend matching the app's SVG legend: one cell per tick,
 * colored by linear interpolation over the colormap break points. */
function drawLegend(
  g: CanvasRenderingContext2D,
  w: number,
  top: number,
  s: number,
  legend: ColormapConfig,
): void {
  const color = d3.scaleLinear(legend.domains, legend.ranges);
  const fmt = d3.format(legend.format);

  const cellW = 34 * s;
  const cellH = 16 * s;
  const rowW = legend.cells.length * cellW;
  const left = (w - rowW) / 2;
  const rowY = top + 62 * s;

  g.textAlign = 'center';
  g.fillStyle = '#333333';
  g.font = `${20 * s}px system-ui, sans-serif`;
  g.fillText(legend.title, w / 2, top + 40 * s);

  g.font = `${15 * s}px system-ui, sans-serif`;
  for (let i = 0; i < legend.cells.length; i++) {
    const x = left + i * cellW;
    g.fillStyle = color(legend.cells[i]) as unknown as string;
    g.fillRect(x, rowY, cellW, cellH);
    g.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    g.lineWidth = 1 * s;
    g.strokeRect(x, rowY, cellW, cellH);
    g.fillStyle = '#333333';
    g.fillText(fmt(legend.cells[i]), x + cellW / 2, rowY + cellH + 22 * s);
  }
}
