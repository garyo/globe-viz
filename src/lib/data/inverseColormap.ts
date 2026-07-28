import * as d3 from 'd3';
import { getColormapConfig } from './colormap';
import type { DatasetId, Metadata, SourceId } from '../../stores/appState';

/** matplotlib's LinearSegmentedColormap default; the pipeline doesn't override it. */
const LUT_SIZE = 256;

export interface InverseLut {
  /** Packed RGB triples, LUT_SIZE entries. */
  rgb: Uint8Array;
  vmin: number;
  vmax: number;
}

export interface SampledValue {
  value: number;
  /** Set when the pixel sits at an end of the colormap, where the true value is
   * unrecoverable — everything beyond the range renders as the same color. */
  clip: 'low' | 'high' | null;
  /** The colormap's own color for this value, as `#rrggbb`. Taken from the LUT
   * rather than the sampled pixel so it's the clean legend color, not one
   * carrying WebP compression noise. */
  color: string;
}

// Keyed by (source, dataset), not dataset alone: the id `sst` belongs to both
// OISST and ERA5. Their ramps are identical today, so a shared entry would work
// by luck — but if either source's cmap ever changed, whichever loaded first
// would silently decode the other's pixels and the values would just be wrong.
const cache = new Map<string, InverseLut | null>();

/**
 * Build (and memoize) the value↔color lookup table for a dataset.
 *
 * This reproduces the exact table the pipeline used to write the texture:
 * `plt.imsave` normalizes with `Normalize(vmin, vmax)` and indexes a 256-entry
 * `LinearSegmentedColormap.from_list(...)`, which is piecewise-linear in sRGB
 * over the metadata `cmap` stops — the same thing `d3.scaleLinear(domains,
 * ranges)` computes, since d3 defaults to `interpolateRgb`.
 *
 * All four ramps in use are strictly injective (256 distinct colors each), so
 * nearest-neighbour is a genuine inverse; the residual error is WebP's lossy
 * compression, not ambiguity in the mapping.
 *
 * The cmap is a property of the dataset, not the date, so one table serves
 * every frame.
 */
export function inverseLutFor(
  source: SourceId,
  dataset: DatasetId,
  metadata: Metadata,
): InverseLut | null {
  const key = `${source}|${dataset}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const config = getColormapConfig(dataset, metadata);
  if (!config) return null; // metadata not loaded yet — don't memoize the miss

  const scale = d3.scaleLinear(config.domains, config.ranges);
  const vmin = config.domains[0];
  const vmax = config.domains[config.domains.length - 1];

  const rgb = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    // matplotlib builds its table over np.linspace(0, 1, N), i.e. i/(N-1).
    const color = d3.rgb(scale(vmin + (i / (LUT_SIZE - 1)) * (vmax - vmin)));
    rgb[i * 3] = Math.round(color.r);
    rgb[i * 3 + 1] = Math.round(color.g);
    rgb[i * 3 + 2] = Math.round(color.b);
  }

  const lut: InverseLut = { rgb, vmin, vmax };
  cache.set(key, lut);
  return lut;
}

/**
 * Recover the value a pixel color was rendered from, by nearest neighbour in
 * RGB. 256 candidates, so a linear scan is well under a microsecond.
 */
export function rgbToValue(lut: InverseLut, r: number, g: number, b: number): SampledValue {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < LUT_SIZE; i++) {
    const dr = r - lut.rgb[i * 3];
    const dg = g - lut.rgb[i * 3 + 1];
    const db = b - lut.rgb[i * 3 + 2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }

  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const color = `#${hex(lut.rgb[best * 3])}${hex(lut.rgb[best * 3 + 1])}${hex(lut.rgb[best * 3 + 2])}`;

  // The end colors absorb everything past the ramp, so a hit there is a bound,
  // not a reading. That's not a rare edge case: SST clips at 0 °C (roughly a
  // fifth of ocean pixels on a given day) and air temp clips at 0 °C by design,
  // so every polar reading lands here.
  if (best === 0) return { value: lut.vmin, clip: 'low', color };
  if (best === LUT_SIZE - 1) return { value: lut.vmax, clip: 'high', color };

  // Entry i stands for the bin [i/N, (i+1)/N) of the normalized range —
  // matplotlib quantizes with floor(t * N) — so report the bin's center.
  return {
    value: lut.vmin + ((best + 0.5) / LUT_SIZE) * (lut.vmax - lut.vmin),
    clip: null,
    color,
  };
}
