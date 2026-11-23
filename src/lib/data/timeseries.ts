import type { BaselineId } from '../../stores/appState';

import { BUCKET_URL } from './assets';

export interface DatasetSeries {
  dates: string[];   // 'YYYY-MM-DD'
  values: number[];  // parallel to dates
  // Anomaly datasets only: per alternative baseline, seasonal coefficients
  // [a0, a1, b1, a2, b2] (°C) of the offset to add to these 1971–2000 values;
  // see seasonalOffset().
  baseline_offsets?: Partial<Record<BaselineId, number[]>>;
}

export interface TimeseriesPayload {
  region: string;
  region_label: string;
  sources: {
    [sourceId: string]: {
      datasets: { [datasetName: string]: DatasetSeries };
      // Earliest date whose values are still provisional and will be revised
      // upstream (NOAA publishes OISST `_preliminary` files for ~2 weeks).
      // Absent when the source has nothing outstanding — and absent entirely
      // from payloads written before the pipeline started emitting it.
      preliminary_from?: string;
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
