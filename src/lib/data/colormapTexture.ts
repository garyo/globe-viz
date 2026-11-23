import * as d3 from 'd3';
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
} from 'three';
import type { Metadata } from '../../stores/appState';

const LUT_SIZE = 1024;

export interface ColormapTexture {
  texture: DataTexture;
  vmin: number;
  vmax: number;
}

const cache = new Map<string, ColormapTexture>();
const scales = new Map<string, d3.ScaleLinear<string, string>>();

/** The colormap as a d3 scale, clamped at both ends like matplotlib's. */
function colormapScale(cmap: Metadata['cmap']): d3.ScaleLinear<string, string> {
  const key = JSON.stringify(cmap);
  let scale = scales.get(key);
  if (!scale) {
    scale = d3.scaleLinear(cmap.map(([v]) => v), cmap.map(([, color]) => color)).clamp(true);
    scales.set(key, scale);
  }
  return scale;
}

/** The colormap's color for a value, as `#rrggbb`. */
export function colormapColor(cmap: Metadata['cmap'], value: number): string {
  return d3.rgb(colormapScale(cmap)(value)).formatHex();
}

/**
 * A 1-D lookup texture for a dataset's colormap, which the globe shader indexes
 * by (value − vmin) / (vmax − vmin). Interpolates the metadata's color stops
 * linearly in sRGB like the pipeline's matplotlib colormap; values past either
 * end clamp to it, as matplotlib's do. Shared across every texture with the
 * same stops.
 */
export function colormapTexture(cmap: Metadata['cmap']): ColormapTexture {
  const key = JSON.stringify(cmap);
  const cached = cache.get(key);
  if (cached) return cached;

  const scale = colormapScale(cmap);
  const vmin = cmap[0][0];
  const vmax = cmap[cmap.length - 1][0];
  const data = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const { r, g, b } = d3.rgb(scale(vmin + ((vmax - vmin) * i) / (LUT_SIZE - 1)));
    data.set([r, g, b, 255], i * 4);
  }
  const texture = new DataTexture(data, LUT_SIZE, 1, RGBAFormat);
  texture.colorSpace = NoColorSpace; // raw sRGB bytes, written out unconverted
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const entry = { texture, vmin, vmax };
  cache.set(key, entry);
  return entry;
}
