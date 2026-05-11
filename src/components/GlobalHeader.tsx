import { For, Show } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  DATASETS_BY_SOURCE,
  isValidDataset,
  defaultDatasetFor,
  type TabId,
  type SourceId,
  type DatasetId,
} from '../stores/appState';
import { ThemeSwitcher } from './controls/ThemeSwitcher';

const TABS: { id: TabId; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'trends', label: 'Trends' },
  { id: 'about', label: 'About' },
];

const SOURCE_LABELS: Record<SourceId, { short: string; full: string }> = {
  oisst: { short: 'OISST', full: 'NOAA OISST' },
  era5: { short: 'ERA5', full: 'ECMWF ERA5' },
};

const DATASET_LABELS: Record<DatasetId, { icon: string; short: string; long: string }> = {
  sst: { icon: '🌡', short: 'Temp', long: 'Sea-surface temperature' },
  anom: { icon: 'Δ', short: 'Anomaly', long: 'SST anomaly vs. 1971–2000 mean' },
  t2m: { icon: '🌬', short: '2 m Air', long: '2 m air temperature' },
};

export const GlobalHeader = () => {
  const switchTab = (id: TabId) => {
    if (appState.activeTab === id) return;
    setAppState('activeTab', id);
    saveState();
  };

  const selectDataset = (id: DatasetId) => {
    if (appState.dataset === id) return;
    setAppState('dataset', id);
    saveState();
  };

  const selectSource = (id: SourceId) => {
    if (appState.source === id) return;
    setAppState('source', id);

    // Reconcile dataset: fall back to the source's first dataset (sst) if the
    // current dataset doesn't exist for this source.
    if (!isValidDataset(id, appState.dataset)) {
      setAppState('dataset', defaultDatasetFor(id));
    }

    // Reconcile date: ERA5 has ~5-day reanalysis latency vs OISST's ~2 days,
    // so the latest few dates may not exist for the source we just switched to.
    // Snap to the most recent date in the source's set that's ≤ the current
    // date; if none exist, fall back to that source's latest.
    const srcDates = appState.sourceDates[id];
    if (srcDates && srcDates.length > 0) {
      const currentDate = appState.availableDates[appState.currentDateIndex];
      if (currentDate && !srcDates.includes(currentDate)) {
        // findLast not in all TS lib targets; walk the (sorted) array.
        let candidate: string | undefined;
        for (let i = srcDates.length - 1; i >= 0; i--) {
          if (srcDates[i] <= currentDate) { candidate = srcDates[i]; break; }
        }
        const snapDate = candidate ?? srcDates[srcDates.length - 1];
        const idx = appState.availableDates.indexOf(snapDate);
        if (idx >= 0) setAppState('currentDateIndex', idx);
      }
    }

    saveState();
  };

  // Datasets to show in the toggle depend on the active source.
  const datasetsForSource = () => DATASETS_BY_SOURCE[appState.source];

  return (
    <header class="global-header">
      <div class="brand">
        <span class="brand-icon" aria-hidden="true">🌐</span>
        <span class="brand-title">Climate Data Explorer</span>
      </div>

      <nav class="tab-bar" aria-label="Main tabs">
        <For each={TABS}>
          {(tab) => (
            <button
              class="tab-button"
              classList={{ active: appState.activeTab === tab.id }}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </nav>

      <div class="global-controls">
        <Show when={appState.availableSources.length > 1}>
          <div class="segmented" role="radiogroup" aria-label="Source">
            <For each={appState.availableSources}>
              {(s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={appState.source === s}
                  aria-label={SOURCE_LABELS[s].full}
                  classList={{ active: appState.source === s }}
                  onClick={() => selectSource(s)}
                  title={SOURCE_LABELS[s].full}
                >
                  <span class="label">{SOURCE_LABELS[s].short}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="segmented" role="radiogroup" aria-label="Dataset">
          <For each={datasetsForSource()}>
            {(d) => (
              <button
                type="button"
                role="radio"
                aria-checked={appState.dataset === d}
                aria-label={DATASET_LABELS[d].long}
                classList={{ active: appState.dataset === d }}
                onClick={() => selectDataset(d)}
                title={DATASET_LABELS[d].long}
              >
                <span class="icon">{DATASET_LABELS[d].icon}</span>
                <span class="label-mobile-hide">{DATASET_LABELS[d].short}</span>
              </button>
            )}
          </For>
        </div>

        <ThemeSwitcher />
      </div>
    </header>
  );
};
