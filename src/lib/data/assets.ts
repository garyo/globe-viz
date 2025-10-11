import type { Metadata } from '../../stores/appState';
import { TextureLoader, LinearSRGBColorSpace, type Texture } from 'three';

const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

// Single dataset assets - only fetch what we need
export interface DatasetAssets {
  texture: Texture;
  metadata: Metadata;
}

// Legacy interface for backward compatibility during migration
export interface Assets {
  sstTexture: Texture;
  sstMetadata: Metadata;
  sstAnomalyTexture: Texture;
  sstAnomalyMetadata: Metadata;
}

export interface DateIndex {
  dates: string[];  // Array of 'YYYY-MM-DD' strings
  latest: string;   // Most recent date
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
 * Fetch assets for a specific dataset and date
 * Only fetches the requested dataset to save memory
 * @param date - Optional date string in YYYY-MM-DD format. If not provided, fetches latest (non-dated) files
 * @param dataset - Which dataset to fetch: 'Temperature' or 'Temp Anomaly'
 * @param textureLoader - Three.js TextureLoader instance for loading textures
 */
export async function fetchDatasetAssets(
  date: string | undefined,
  dataset: 'Temperature' | 'Temp Anomaly',
  textureLoader: TextureLoader
): Promise<DatasetAssets> {
  // If date is provided, use date-prefixed filenames
  const prefix = date ? `${date}-` : '';

  // Determine which files to fetch based on dataset
  const isTemperature = dataset === 'Temperature';
  const suffix = isTemperature ? 'sst-temp-equirect' : 'sst-temp-anomaly-equirect';

  const textureUrl = BUCKET_URL + `${prefix}${suffix}.webp`;
  const metadataUrl = BUCKET_URL + `${prefix}${suffix}-metadata.json`;

  const [textureBlob, metadata] = await Promise.all([
    fetch(textureUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${dataset} texture: ${res.statusText}`);
      return res.blob();
    }),
    fetch(metadataUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${dataset} metadata: ${res.statusText}`);
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
  texture.userData.dataset = dataset;

  return {
    texture,
    metadata,
  };
}

/**
 * Fetch assets for a specific date (LEGACY - fetches both datasets)
 * Creates Three.js Texture objects immediately to avoid decode during rendering
 * @param date - Optional date string in YYYY-MM-DD format. If not provided, fetches latest (non-dated) files
 * @param textureLoader - Three.js TextureLoader instance for loading textures
 * @deprecated Use fetchDatasetAssets instead to save memory
 */
export async function fetchAssetsForDate(date: string | undefined, textureLoader: TextureLoader): Promise<Assets> {
  const [tempAssets, anomalyAssets] = await Promise.all([
    fetchDatasetAssets(date, 'Temperature', textureLoader),
    fetchDatasetAssets(date, 'Temp Anomaly', textureLoader),
  ]);

  return {
    sstTexture: tempAssets.texture,
    sstMetadata: tempAssets.metadata,
    sstAnomalyTexture: anomalyAssets.texture,
    sstAnomalyMetadata: anomalyAssets.metadata,
  };
}

/**
 * Fetch the latest assets (backward compatibility)
 */
export async function fetchAssets(textureLoader: TextureLoader): Promise<Assets> {
  return fetchAssetsForDate(undefined, textureLoader);
}
