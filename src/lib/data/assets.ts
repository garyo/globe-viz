import type { Metadata, SourceId, DatasetId } from '../../stores/appState';
import { TextureLoader, LinearSRGBColorSpace, type Texture } from 'three';

const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

// Single dataset assets - only fetch what we need
export interface DatasetAssets {
  texture: Texture;
  metadata: Metadata;
}

export interface SourceDateMeta {
  dates: string[];   // Dated textures that exist for this source
  latest: string | null;
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
 * Fetch the index of available dates from S3
 */
export async function fetchDateIndex(): Promise<DateIndex> {
  const response = await fetch(BUCKET_URL + 'index.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch date index: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Build the equirect texture URL stem (without `.webp` / `-metadata.json`) for
 * a given (source, dataset, date). OISST keeps its legacy unprefixed naming
 * (`<date>-sst-temp-equirect`, `<date>-sst-temp-anomaly-equirect`) so old
 * client deployments and bookmarks keep working; newer sources use a uniform
 * `<date>-<source>-<dataset>-equirect` scheme.
 */
function equirectStem(source: SourceId, dataset: DatasetId, date: string | undefined): string {
  const datePrefix = date ? `${date}-` : '';
  if (source === 'oisst') {
    const suffix = dataset === 'sst' ? 'sst-temp' : 'sst-temp-anomaly';
    return `${datePrefix}${suffix}-equirect`;
  }
  return `${datePrefix}${source}-${dataset}-equirect`;
}

/**
 * Fetch assets for a specific source × dataset × date.
 * @param date - Optional date string in YYYY-MM-DD format. If not provided, fetches latest (non-dated) files.
 * @param source - Which source to fetch ('oisst', 'era5', ...).
 * @param dataset - Which dataset to fetch ('sst', 'anom', 't2m').
 * @param textureLoader - Three.js TextureLoader instance for loading textures.
 */
export async function fetchDatasetAssets(
  date: string | undefined,
  source: SourceId,
  dataset: DatasetId,
  textureLoader: TextureLoader
): Promise<DatasetAssets> {
  const stem = equirectStem(source, dataset, date);
  const textureUrl = BUCKET_URL + `${stem}.webp`;
  const metadataUrl = BUCKET_URL + `${stem}-metadata.json`;

  const [textureBlob, metadata] = await Promise.all([
    fetch(textureUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${source}/${dataset} texture: ${res.statusText}`);
      return res.blob();
    }),
    fetch(metadataUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${source}/${dataset} metadata: ${res.statusText}`);
      return res.json();
    }),
  ]);

  // Create Three.js texture from blob
  const textureUrl_obj = URL.createObjectURL(textureBlob);
  const texture = await textureLoader.loadAsync(textureUrl_obj);

  // Configure texture
  texture.colorSpace = LinearSRGBColorSpace;
  texture.userData.objectUrl = textureUrl_obj;
  texture.userData.date = date;
  texture.userData.source = source;
  texture.userData.dataset = dataset;

  return {
    texture,
    metadata,
  };
}
