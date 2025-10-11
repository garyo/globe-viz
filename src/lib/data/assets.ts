import type { Metadata } from '../../stores/appState';
import { TextureLoader, LinearSRGBColorSpace, type Texture } from 'three';

const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

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
 * Fetch assets for a specific date, or the latest if no date is provided
 * Creates Three.js Texture objects immediately to avoid decode during rendering
 * @param date - Optional date string in YYYY-MM-DD format. If not provided, fetches latest (non-dated) files
 * @param textureLoader - Three.js TextureLoader instance for loading textures
 */
export async function fetchAssetsForDate(date: string | undefined, textureLoader: TextureLoader): Promise<Assets> {
  // If date is provided, use date-prefixed filenames
  const prefix = date ? `${date}-` : '';

  const sstTextureUrl = BUCKET_URL + `${prefix}sst-temp-equirect.webp`;
  const sstMetadataUrl = BUCKET_URL + `${prefix}sst-temp-equirect-metadata.json`;
  const sstAnomalyTextureUrl = BUCKET_URL + `${prefix}sst-temp-anomaly-equirect.webp`;
  const sstAnomalyMetadataUrl = BUCKET_URL + `${prefix}sst-temp-anomaly-equirect-metadata.json`;

  const [sstTextureBlob, sstMetadata, sstAnomalyTextureBlob, sstAnomalyMetadata] =
    await Promise.all([
      fetch(sstTextureUrl).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch SST texture: ${res.statusText}`);
        return res.blob();
      }),
      fetch(sstMetadataUrl).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch SST metadata: ${res.statusText}`);
        return res.json();
      }),
      fetch(sstAnomalyTextureUrl).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch SST anomaly texture: ${res.statusText}`);
        return res.blob();
      }),
      fetch(sstAnomalyMetadataUrl).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch SST anomaly metadata: ${res.statusText}`);
        return res.json();
      }),
    ]);

  // Create Three.js textures from blobs
  const sstTextureUrl_obj = URL.createObjectURL(sstTextureBlob);
  const sstAnomalyTextureUrl_obj = URL.createObjectURL(sstAnomalyTextureBlob);

  const [sstTexture, sstAnomalyTexture] = await Promise.all([
    textureLoader.loadAsync(sstTextureUrl_obj),
    textureLoader.loadAsync(sstAnomalyTextureUrl_obj),
  ]);

  // Configure textures
  sstTexture.colorSpace = LinearSRGBColorSpace;
  sstTexture.userData.objectUrl = sstTextureUrl_obj;
  sstTexture.userData.date = date;

  sstAnomalyTexture.colorSpace = LinearSRGBColorSpace;
  sstAnomalyTexture.userData.objectUrl = sstAnomalyTextureUrl_obj;
  sstAnomalyTexture.userData.date = date;

  return {
    sstTexture,
    sstMetadata,
    sstAnomalyTexture,
    sstAnomalyMetadata,
  };
}

/**
 * Fetch the latest assets (backward compatibility)
 */
export async function fetchAssets(textureLoader: TextureLoader): Promise<Assets> {
  return fetchAssetsForDate(undefined, textureLoader);
}
