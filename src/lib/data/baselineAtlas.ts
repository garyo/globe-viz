import type { TextureLoader } from 'three';
import {
  REFERENCE_BASELINE,
  anomalyOf,
  type BaselineId,
  type DatasetId,
  type SourceId,
} from '../../stores/appState';
import type { BaselineAtlas } from '../scene/globe';
import { leapAlignedDayOfYear, seasonalOffset } from '../timeseriesUtils';
import { BUCKET_URL } from './assets';
import { loadRg16Texture, rg16Value, type Rg16Encoding } from './rg16';
import { samplePixel } from './sampleTexture';

/**
 * Per-pixel baseline offsets, published by sea-surface-temp-viz's
 * build_baseline_deltas.py under `baselines/`: one atlas per (field, baseline)
 * holding the five seasonal coefficients [a0, a1, b1, a2, b2] as tiles, plus a
 * manifest saying which atlas applies to each (baseline, source, dataset).
 */
interface Manifest {
  encoding: Rg16Encoding;
  terms: string[];
  tile_width: number;
  tile_height: number;
  fields: Partial<Record<BaselineId, Record<string, Record<string, string>>>>;
}

const BASELINE_URL = BUCKET_URL + 'baselines/';

let manifest: Promise<Manifest | null> | undefined;
const atlases = new Map<string, Promise<BaselineAtlas>>();

function loadManifest(): Promise<Manifest | null> {
  manifest ??= fetch(BASELINE_URL + 'manifest.json')
    .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : null))
    .catch(() => null)
    .then((m) => {
      if (!m) manifest = undefined; // retry on the next request
      return m;
    });
  return manifest;
}

/**
 * The offset atlas that re-baselines this (source, dataset), or null when the
 * reference baseline (or a raw, non-anomaly dataset) needs none. Loaded once
 * and shared by every dataset that uses the same field. Rejects when the
 * offsets aren't published or won't load, so callers never present
 * 1971–2000 values under another baseline's name.
 */
export async function baselineAtlasFor(
  baseline: BaselineId,
  source: SourceId,
  dataset: DatasetId,
  loader: TextureLoader,
): Promise<BaselineAtlas | null> {
  if (baseline === REFERENCE_BASELINE || !anomalyOf(dataset)) return null;
  const m = await loadManifest();
  const file = m?.fields[baseline]?.[source]?.[dataset];
  if (!m || !file) throw new Error(`No ${baseline} offsets published for ${source}/${dataset}`);
  let atlas = atlases.get(file);
  if (!atlas) {
    atlas = loadRg16Texture(BASELINE_URL + file, loader).then((texture) => ({
      texture,
      encoding: m.encoding,
      tileHeight: m.tile_height,
    }));
    atlases.set(file, atlas);
    atlas.catch(() => atlases.delete(file)); // let a later request retry
  }
  return atlas;
}

/**
 * The offset at one cell on one date, read from the atlas exactly as the
 * shader computes it (minus interpolation, matching the readout's
 * nearest-cell values). `px`/`py` are image coordinates on the data grid.
 */
export function baselineOffsetAt(
  atlas: BaselineAtlas,
  px: number,
  py: number,
  date: string,
): number | null {
  const coefficients: number[] = [];
  for (let k = 0; k < 5; k++) {
    const pixel = samplePixel(atlas.texture, px, k * atlas.tileHeight + py);
    const value = pixel && rg16Value(atlas.encoding, pixel.r, pixel.g);
    if (value === null) return null;
    coefficients.push(value);
  }
  return seasonalOffset(coefficients, leapAlignedDayOfYear(date));
}
