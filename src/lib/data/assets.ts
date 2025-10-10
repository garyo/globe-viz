import type { Metadata } from '../../stores/appState';

const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

export interface Assets {
  sstTexture: Blob;
  sstMetadata: Metadata;
  sstAnomalyTexture: Blob;
  sstAnomalyMetadata: Metadata;
}

export async function fetchAssets(): Promise<Assets> {
  const sstTextureUrl = BUCKET_URL + 'sst-temp-equirect.png';
  const sstMetadataUrl = BUCKET_URL + 'sst-temp-equirect-metadata.json';
  const sstAnomalyTextureUrl = BUCKET_URL + 'sst-temp-anomaly-equirect.png';
  const sstAnomalyMetadataUrl = BUCKET_URL + 'sst-temp-anomaly-equirect-metadata.json';

  const [sstTextureResult, sstMetadataResult, sstAnomalyTextureResult, sstAnomalyMetadataResult] =
    await Promise.all([
      fetch(sstTextureUrl),
      fetch(sstMetadataUrl),
      fetch(sstAnomalyTextureUrl),
      fetch(sstAnomalyMetadataUrl),
    ]);

  return {
    sstTexture: await sstTextureResult.blob(),
    sstMetadata: await sstMetadataResult.json(),
    sstAnomalyTexture: await sstAnomalyTextureResult.blob(),
    sstAnomalyMetadata: await sstAnomalyMetadataResult.json(),
  };
}
