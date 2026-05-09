const BUCKET_URL = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/';

export interface DatasetSeries {
  dates: string[];   // 'YYYY-MM-DD'
  values: number[];  // parallel to dates
}

export interface TimeseriesPayload {
  region: string;
  region_label: string;
  sources: {
    [sourceId: string]: {
      datasets: { [datasetName: string]: DatasetSeries };
    };
  };
  updated: string;
}

const cache = new Map<string, TimeseriesPayload>();

/**
 * Fetch the time-series JSON for a given region from S3.
 * Cached in memory for the lifetime of the page.
 */
export async function fetchTimeseries(region: string): Promise<TimeseriesPayload> {
  const cached = cache.get(region);
  if (cached) return cached;

  const res = await fetch(BUCKET_URL + `timeseries/${region}.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch timeseries for ${region}: ${res.statusText}`);
  }
  const data = (await res.json()) as TimeseriesPayload;
  cache.set(region, data);
  return data;
}
