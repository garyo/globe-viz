import { For, Show, createMemo, createResource } from 'solid-js';
import { appState, setAppState, saveState, type DatasetId } from '../stores/appState';
import { fetchTimeseries, type TimeseriesPayload } from '../lib/data/timeseries';
import { readThemeColors } from '../lib/timeseriesUtils';
import { MiniChart } from './MiniChart';

const REGION_LABELS: Record<string, string> = {
  global: 'Global',
  trop: 'Tropics',
  n_hemi: 'N. Hemisphere',
  s_hemi: 'S. Hemisphere',
  nino_3_4: 'Niño 3.4',
  pacific: 'Pacific',
  atlantic: 'Atlantic',
  indian: 'Indian',
  arctic: 'Arctic',
  antarctic: 'Southern Ocean',
};

// Display order in the grid: global first (it's the most familiar), then the
// other bbox regions, then ocean basins. Anything unrecognized goes last.
const ORDER = [
  'global', 'trop', 'n_hemi', 's_hemi', 'nino_3_4',
  'pacific', 'atlantic', 'indian', 'arctic', 'antarctic',
];
const orderRank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length + id.charCodeAt(0) : i;
};

const formatValue = (v: number, ds: DatasetId): string =>
  ds === 'anom' ? `Δ ${v.toFixed(2)} °C` : `${v.toFixed(2)} °C`;

export const TrendsGrid = () => {
  // Fetch every available region's payload in parallel. fetchTimeseries
  // already has its own per-region in-memory cache, so re-renders re-use the
  // existing entries even when this component is mounted/unmounted.
  const [payloads] = createResource(
    () => appState.availableRegions,
    async (regions): Promise<Array<[string, TimeseriesPayload]>> => {
      const entries = await Promise.all(
        regions.map((r) =>
          fetchTimeseries(r).then((p) => [r, p] as [string, TimeseriesPayload]).catch(() => null)
        )
      );
      return entries.filter((e): e is [string, TimeseriesPayload] => e !== null);
    }
  );

  const sourceKey = () => appState.source;
  const datasetKey = (): DatasetId => appState.dataset;

  // Theme colors: read reactively whenever effectiveTheme flips so MiniChart
  // re-renders with the new palette via its own createEffect.
  const colors = createMemo(() => {
    appState.effectiveTheme; // dependency
    return readThemeColors();
  });

  // Sorted (region_id, payload) pairs so the grid order is stable.
  const sortedEntries = () => {
    const arr = payloads();
    if (!arr) return [];
    return [...arr].sort(
      ([a], [b]) => orderRank(a) - orderRank(b)
    );
  };

  const onCellClick = (regionId: string) => {
    setAppState('region', regionId);
    setAppState('trendsMode', 'single');
    saveState();
  };

  return (
    <div class="trends-grid">
      <Show when={payloads.error}>
        <div class="trends-error">
          Failed to load region data: {String(payloads.error)}
        </div>
      </Show>
      <Show when={payloads.loading}>
        <div class="trends-loading">Loading regions…</div>
      </Show>
      <Show when={payloads()}>
        <div class="trends-grid-cells">
          <For each={sortedEntries()}>
            {([regionId, payload]) => {
              // Solid's <For> callback runs once per item, so anything that
              // depends on appState.source/dataset must be wrapped in a memo
              // to remain reactive across source/dataset toggles.
              const series = createMemo(
                () => payload.sources[sourceKey()]?.datasets[datasetKey()]
              );
              const lastVal = () => {
                const s = series();
                return s && s.values.length ? s.values[s.values.length - 1] : null;
              };
              const lastDate = () => {
                const s = series();
                return s && s.dates.length ? s.dates[s.dates.length - 1] : null;
              };
              return (
                <button
                  type="button"
                  class="trends-grid-cell"
                  onClick={() => onCellClick(regionId)}
                  title={`Click to expand ${REGION_LABELS[regionId] ?? regionId}`}
                >
                  <div class="trends-grid-cell-header">
                    <span class="trends-grid-label">
                      {REGION_LABELS[regionId] ?? regionId}
                    </span>
                    <Show when={lastVal() !== null}>
                      <span class="trends-grid-value">
                        {formatValue(lastVal()!, datasetKey())}
                      </span>
                    </Show>
                  </div>
                  <div class="trends-grid-cell-body">
                    <Show
                      when={series()}
                      fallback={<div class="trends-grid-empty">no data</div>}
                    >
                      <MiniChart series={series()!} colors={colors()} />
                    </Show>
                  </div>
                  <Show when={lastDate()}>
                    <div class="trends-grid-cell-footer">{lastDate()}</div>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
