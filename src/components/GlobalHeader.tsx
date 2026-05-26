import { For, Show } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  isValidDataset,
  defaultDatasetFor,
  variableOf,
  anomalyOf,
  datasetFor,
  variablesFor,
  hasAnomalyFor,
  type TabId,
  type SourceId,
  type Variable,
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

// Variable buttons (orthogonal to the anomaly toggle below). OISST has only
// SST; ERA5 adds 2 m air temperature.
const VARIABLE_LABELS: Record<Variable, { icon: string; short: string; long: string }> = {
  sst: { icon: '🌡', short: 'Sea Temp', long: 'Sea-surface temperature' },
  t2m: { icon: '🌬', short: 'Air Temp', long: '2 m air temperature' },
};

export const GlobalHeader = () => {
  const switchTab = (id: TabId) => {
    if (appState.activeTab === id) return;
    setAppState('activeTab', id);
    saveState();
  };

  // Variable + anomaly are the user-facing knobs; we compose them back into
  // the raw DatasetId so the rest of the app keeps working unchanged.
  const currentVariable = (): Variable => variableOf(appState.dataset);
  const currentAnomaly = (): boolean => anomalyOf(appState.dataset);

  const applyDatasetChoice = (variable: Variable, anomaly: boolean) => {
    const next = datasetFor(appState.source, variable, anomaly);
    if (!next || next === appState.dataset) return;
    setAppState('dataset', next);
    saveState();
  };

  const selectVariable = (v: Variable) => {
    // Keep anomaly preference if the new variable supports it; otherwise drop
    // back to raw (the user can re-check if/when t2m_anom ships).
    const wantAnom = currentAnomaly() && hasAnomalyFor(appState.source, v);
    applyDatasetChoice(v, wantAnom);
  };

  const toggleAnomaly = () => {
    applyDatasetChoice(currentVariable(), !currentAnomaly());
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

  // Variables visible to the user depend on the active source.
  const variablesForSource = () => variablesFor(appState.source);
  const anomalyAvailable = () => hasAnomalyFor(appState.source, currentVariable());

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

        <Show when={variablesForSource().length > 1}>
          <div class="segmented" role="radiogroup" aria-label="Variable">
            <For each={variablesForSource()}>
              {(v) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={currentVariable() === v}
                  aria-label={VARIABLE_LABELS[v].long}
                  classList={{ active: currentVariable() === v }}
                  onClick={() => selectVariable(v)}
                  title={VARIABLE_LABELS[v].long}
                >
                  <span class="icon">{VARIABLE_LABELS[v].icon}</span>
                  <span class="label-mobile-hide">{VARIABLE_LABELS[v].short}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <label
          class="anomaly-toggle"
          title={
            anomalyAvailable()
              ? 'Show anomaly vs. 1971–2000 climatology'
              : 'Anomaly not yet available for this variable'
          }
        >
          <input
            type="checkbox"
            checked={currentAnomaly()}
            disabled={!anomalyAvailable()}
            onChange={toggleAnomaly}
            aria-label="Show anomaly"
          />
          <span class="label-mobile-hide">Δ Anomaly</span>
        </label>

        <ThemeSwitcher />
      </div>
    </header>
  );
};
