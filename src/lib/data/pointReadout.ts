import type { TextureLoader } from 'three';
import {
  appState,
  anomalyOf,
  datesForSelection,
  hasTextureData,
  statisticOf,
  variableOf,
  DATASETS_BY_SOURCE,
  SOURCE_LABELS,
  type DatasetId,
  type PickedPoint,
  type SourceId,
  type Variable,
} from '../../stores/appState';
import { latLonToPixel } from '../scene/geo';
import { fetchDatasetAssets, type DatasetAssets } from './assets';
import { inverseLutFor, rgbToValue } from './inverseColormap';
import { samplePixel, textureSize } from './sampleTexture';
import type { TextureCache } from './textureCache';

/**
 * Why a cell has no number, which splits two ways for the reader:
 *  - `masked` is a statement about the place — there's a map for this date, but
 *    the point is land or sea ice.
 *  - `unpublished` / `unavailable` are statements about the data — nothing to
 *    sample, either because this source has no map for this date or because we
 *    haven't loaded it (playback samples cache-only).
 */
export interface ReadoutCell {
  state: 'pending' | 'value' | 'masked' | 'unpublished' | 'unavailable';
  value?: number;
  /** Set when the pixel sits at an end of the colormap and the value is a bound. */
  clip?: 'low' | 'high';
  /** This dataset's colormap color for the value — ties the number to the map. */
  color?: string;
}

/**
 * One measurement at the picked point, pairing a value with its anomaly.
 *
 * A source publishes both as separate textures, but they're the same
 * measurement seen two ways, so the readout shows them side by side rather
 * than as two rows to scroll past. Either cell is null when that source
 * doesn't publish that half.
 */
export interface ReadoutRow {
  label: string;
  actual: ReadoutCell | null;
  anomaly: ReadoutCell | null;
}

/** Which texture feeds which cell — the flat work list behind the row table. */
interface SampleJob {
  row: number;
  slot: 'actual' | 'anomaly';
  source: SourceId;
  dataset: DatasetId;
}

const VARIABLE_LABELS: Record<Variable, string> = {
  sst: 'Sea temp',
  t2m: 'Air temp',
};

function rowLabel(source: SourceId, dataset: DatasetId): string {
  const statistic = statisticOf(dataset);
  const variable = VARIABLE_LABELS[variableOf(dataset)];
  return `${SOURCE_LABELS[source].short} · ${variable}${statistic ? ` (${statistic})` : ''}`;
}

/**
 * Build the row table: one row per (source, variable, statistic) that this
 * deployment publishes at all.
 *
 * Deliberately independent of the date. Sources run at different latencies, so
 * filtering rows by what exists today would make them appear and vanish as
 * playback crosses each source's coverage boundary — the table would jump under
 * the reader's eyes. Instead the rows hold still and the cells say `unpublished`
 * where a source hasn't reached that date.
 */
function planRows(date: string): { rows: ReadoutRow[]; jobs: SampleJob[] } {
  const rows: ReadoutRow[] = [];
  const jobs: SampleJob[] = [];
  const index = new Map<string, number>();

  for (const source of appState.availableSources) {
    for (const dataset of DATASETS_BY_SOURCE[source]) {
      // A dataset with no textures anywhere is a capability that exists in code
      // but was never built (GFS max/min anomalies, until their climatologies
      // land). Those get no row at all rather than a permanently empty one.
      if (!hasTextureData(source, dataset)) continue;

      const key = `${source}|${variableOf(dataset)}|${statisticOf(dataset) ?? ''}`;
      let row = index.get(key);
      if (row === undefined) {
        row = rows.length;
        index.set(key, row);
        rows.push({ label: rowLabel(source, dataset), actual: null, anomaly: null });
      }

      const slot = anomalyOf(dataset) ? 'anomaly' : 'actual';
      if (datesForSelection(source, dataset).includes(date)) {
        rows[row][slot] = { state: 'pending' };
        jobs.push({ row, slot, source, dataset });
      } else {
        rows[row][slot] = { state: 'unpublished' };
      }
    }
  }
  return { rows, jobs };
}

/** Read one dataset's value at a point, given assets already in hand. */
function readCell(
  assets: DatasetAssets,
  source: SourceId,
  dataset: DatasetId,
  point: PickedPoint,
): ReadoutCell {
  const size = textureSize(assets.texture);
  const lut = inverseLutFor(source, dataset, assets.metadata);
  if (!size || !lut) return { state: 'unavailable' };

  const { px, py } = latLonToPixel(point, size.width, size.height);
  const pixel = samplePixel(assets.texture, px, py);
  if (!pixel) return { state: 'unavailable' };

  // Masked cells (land, sea ice, out-of-range latitude) are written as fully
  // transparent by matplotlib's "bad" color. Datasets defined everywhere —
  // air temp — ship as RGB with no alpha channel, so this never fires for them.
  if (pixel.a === 0) return { state: 'masked' };

  const { value, clip, color } = rgbToValue(lut, pixel.r, pixel.g, pixel.b);
  return { state: 'value', value, clip: clip ?? undefined, color };
}

export interface ReadoutOptions {
  /** Fetch textures that aren't cached yet. False while playing, where a fetch
   *  per frame would swamp the network and evict the animation's own textures. */
  allowFetch: boolean;
  /** Called with the full row list each time more of it resolves. */
  onUpdate: (rows: ReadoutRow[]) => void;
  /** Return false to abandon a stale run (new pick, or the date moved on). */
  isCurrent: () => boolean;
}

/**
 * Sample every available dataset at a point, reporting progressively.
 *
 * Values come from inverting the colormap that produced the texture, because no
 * per-cell data product is published — see inverseColormap.ts. Cached textures
 * resolve in the first synchronous pass; the rest stream in.
 */
export async function readPointValues(
  point: PickedPoint,
  date: string,
  textureCache: TextureCache,
  textureLoader: TextureLoader,
  options: ReadoutOptions,
): Promise<void> {
  const { rows, jobs } = planRows(date);
  options.onUpdate(rows);
  if (jobs.length === 0) return;

  const pending: SampleJob[] = [];
  for (const job of jobs) {
    const cached = textureCache.get(date, job.source, job.dataset);
    if (cached) rows[job.row][job.slot] = readCell(cached, job.source, job.dataset, point);
    else if (options.allowFetch) pending.push(job);
    else rows[job.row][job.slot] = { state: 'unavailable' };
  }
  options.onUpdate(rows.map((row) => ({ ...row })));
  if (pending.length === 0 || !options.isCurrent()) return;

  await Promise.all(
    pending.map(async (job) => {
      try {
        const assets = await fetchDatasetAssets(date, job.source, job.dataset, textureLoader);
        // Sampling is CPU-side, so deliberately no renderer.initTexture here —
        // these textures may never reach the GPU.
        textureCache.set(date, job.source, job.dataset, assets);
        if (!options.isCurrent()) return;
        rows[job.row][job.slot] = readCell(assets, job.source, job.dataset, point);
      } catch {
        rows[job.row][job.slot] = { state: 'unavailable' };
      }
      if (options.isCurrent()) options.onUpdate(rows.map((row) => ({ ...row })));
    }),
  );
}
