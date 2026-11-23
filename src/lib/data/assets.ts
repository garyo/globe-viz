import type { Metadata, SourceId, DatasetId } from '../../stores/appState';
import type { TextureLoader, Texture } from 'three';
import { colormapTexture } from './colormapTexture';
import { loadRg16Texture } from './rg16';

export const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

// Single dataset assets - only fetch what we need
export interface DatasetAssets {
  texture: Texture;
  metadata: Metadata;
}

export interface DatasetDateMeta {
  dates: string[];   // Dated textures that exist for this source × dataset
  latest: string | null;
  // Dates with a 16-bit data texture — the only kind this globe draws. Listed
  // separately because older site versions still read `dates`.
  data_dates?: string[];
}

export interface SourceDateMeta {
  dates: string[];   // Union of dated textures across this source's datasets
  latest: string | null;
  // Per-dataset breakdown, when the index exposes it. Anomaly variants can lag
  // (or pre-date-gap) their base variable, so `datasets.sst_anom.dates` is a
  // subset of `dates`. Absent in older index.json files.
  datasets?: { [datasetId: string]: DatasetDateMeta };
}

export interface DateIndex {
  dates: string[];  // Union of dated textures across all sources
  latest: string;   // Most recent date (OISST's latest, for back-compat)
  sources?: { [sourceId: string]: SourceDateMeta };
  timeseries?: {
    regions: string[];   // Region IDs available under timeseries/<id>.json
    sources?: string[];  // Source IDs present in the timeseries JSONs
  };
}

/**
 * Fetch the index of available dates from S3, restricted to data textures.
 */
export async function fetchDateIndex(): Promise<DateIndex> {
  const response = await fetch(BUCKET_URL + 'index.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch date index: ${response.statusText}`);
  }
  return dataTextureIndex(await response.json());
}

const latestOf = (dates: string[]) => dates[dates.length - 1] ?? null;

/**
 * Rewrite an index so every date list counts only data textures: each
 * dataset's `dates` become its `data_dates`, and the per-source and global
 * unions are rebuilt from those. Everything downstream can then keep reading
 * `dates` without knowing that S3 also holds color-mapped images for older
 * clients. Datasets without data textures drop out.
 */
function dataTextureIndex(index: DateIndex): DateIndex {
  const sources: Record<string, SourceDateMeta> = {};
  const all = new Set<string>();
  for (const [src, meta] of Object.entries(index.sources ?? {})) {
    const datasets: Record<string, DatasetDateMeta> = {};
    const union = new Set<string>();
    for (const [ds, info] of Object.entries(meta.datasets ?? {})) {
      if (!info.data_dates?.length) continue;
      datasets[ds] = { dates: info.data_dates, latest: latestOf(info.data_dates) };
      info.data_dates.forEach((d) => union.add(d));
    }
    if (union.size === 0) continue;
    const dates = [...union].sort();
    sources[src] = { dates, latest: latestOf(dates), datasets };
    dates.forEach((d) => all.add(d));
  }
  const dates = [...all].sort();
  return {
    ...index,
    dates,
    latest: sources.oisst?.latest ?? latestOf(dates) ?? index.latest,
    sources,
  };
}

/**
 * URL stem (without `.webp` / `-metadata.json`) of a data texture:
 * `<date>-<source>-<dataset>-data`, with the dataset id's underscores as
 * hyphens, as sea-surface-temp-viz's DataSource.data_texture_filename writes.
 */
function dataTextureStem(source: SourceId, dataset: DatasetId, date: string): string {
  return `${date}-${source}-${dataset.replace(/_/g, '-')}-data`;
}

/**
 * Fetch the data texture and metadata for a source × dataset × date.
 *
 * The texture carries everything the globe shader needs to draw it in
 * `userData`: its date, its value encoding, and its colormap lookup texture.
 */
export async function fetchDatasetAssets(
  date: string,
  source: SourceId,
  dataset: DatasetId,
  textureLoader: TextureLoader
): Promise<DatasetAssets> {
  const stem = dataTextureStem(source, dataset, date);
  const textureUrl = BUCKET_URL + `${stem}.webp`;
  const metadataUrl = BUCKET_URL + `${stem}-metadata.json`;

  const [texture, metadata] = await Promise.all([
    loadRg16Texture(textureUrl, textureLoader),
    fetch(metadataUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${source}/${dataset} metadata: ${res.statusText}`);
      return res.json() as Promise<Metadata>;
    }),
  ]);

  texture.userData.date = date;
  texture.userData.source = source;
  texture.userData.dataset = dataset;
  texture.userData.encoding = metadata.encoding;
  texture.userData.colormap = colormapTexture(metadata.cmap);

  return {
    texture,
    metadata,
  };
}
