import type { Metadata } from '../../stores/appState';

const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

export interface Assets {
  sstTexture: Blob;
  sstMetadata: Metadata;
  sstAnomalyTexture: Blob;
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
 * @param date - Optional date string in YYYY-MM-DD format. If not provided, fetches latest (non-dated) files
 */
export async function fetchAssetsForDate(date?: string): Promise<Assets> {
  // If date is provided, use date-prefixed filenames
  const prefix = date ? `${date}-` : '';

  const sstTextureUrl = BUCKET_URL + `${prefix}sst-temp-equirect.png`;
  const sstMetadataUrl = BUCKET_URL + `${prefix}sst-temp-equirect-metadata.json`;
  const sstAnomalyTextureUrl = BUCKET_URL + `${prefix}sst-temp-anomaly-equirect.png`;
  const sstAnomalyMetadataUrl = BUCKET_URL + `${prefix}sst-temp-anomaly-equirect-metadata.json`;

  const [sstTextureResult, sstMetadataResult, sstAnomalyTextureResult, sstAnomalyMetadataResult] =
    await Promise.all([
      fetch(sstTextureUrl),
      fetch(sstMetadataUrl),
      fetch(sstAnomalyTextureUrl),
      fetch(sstAnomalyMetadataUrl),
    ]);

  // Check for errors
  if (!sstTextureResult.ok || !sstMetadataResult.ok ||
      !sstAnomalyTextureResult.ok || !sstAnomalyMetadataResult.ok) {
    throw new Error(`Failed to fetch assets for date: ${date || 'latest'}`);
  }

  return {
    sstTexture: await sstTextureResult.blob(),
    sstMetadata: await sstMetadataResult.json(),
    sstAnomalyTexture: await sstAnomalyTextureResult.blob(),
    sstAnomalyMetadata: await sstAnomalyMetadataResult.json(),
  };
}

/**
 * Fetch the latest assets (backward compatibility)
 */
export async function fetchAssets(): Promise<Assets> {
  return fetchAssetsForDate();
}
