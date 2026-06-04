import { For, Show } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  applyView,
  selectVariable,
  variableOf,
  anomalyOf,
  sourcesFor,
  allVariables,
  hasAnomalyFor,
  SOURCE_LABELS,
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

// Variable buttons. Every variable is always visible; picking one hops to a
// source that offers it (Air Temp implies ERA5), so the control never
// appears/disappears as the source changes.
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

  // The user-facing knobs, in priority order: variable, actual-vs-anomaly,
  // then source (a provenance detail, demoted to a small picker). All
  // selection logic lives in appState (applyView / selectVariable) so the
  // keyboard shortcuts share it.
  const currentVariable = (): Variable => variableOf(appState.dataset);
  const currentAnomaly = (): boolean => anomalyOf(appState.dataset);

  const setAnomaly = (anomaly: boolean) =>
    applyView(appState.source, currentVariable(), anomaly);
  const selectSource = (s: SourceId) =>
    applyView(s, currentVariable(), currentAnomaly());

  const sourceChoices = () => sourcesFor(currentVariable());
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
        <Show when={allVariables().length > 1}>
          <div class="segmented" role="radiogroup" aria-label="Variable">
            <For each={allVariables()}>
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

        <div class="segmented" role="radiogroup" aria-label="Mode">
          <button
            type="button"
            role="radio"
            aria-checked={!currentAnomaly()}
            classList={{ active: !currentAnomaly() }}
            onClick={() => setAnomaly(false)}
            title="Absolute temperature"
          >
            Actual
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={currentAnomaly()}
            classList={{ active: currentAnomaly() }}
            disabled={!anomalyAvailable()}
            onClick={() => setAnomaly(true)}
            title={
              anomalyAvailable()
                ? 'Difference vs. 1971–2000 climatology'
                : 'Anomaly not yet available for this variable'
            }
          >
            Δ Anomaly
          </button>
        </div>

        <Show
          when={sourceChoices().length > 1}
          fallback={
            <span class="source-label" title={SOURCE_LABELS[appState.source].full}>
              {SOURCE_LABELS[appState.source].short}
            </span>
          }
        >
          <select
            class="source-select"
            aria-label="Data source"
            title={SOURCE_LABELS[appState.source].full}
            value={appState.source}
            onChange={(e) => selectSource(e.currentTarget.value as SourceId)}
          >
            <For each={sourceChoices()}>
              {(s) => <option value={s}>{SOURCE_LABELS[s].short}</option>}
            </For>
          </select>
        </Show>

        <ThemeSwitcher />
      </div>

      <Show when={appState.notice}>
        <div class="header-notice" role="status">{appState.notice}</div>
      </Show>
    </header>
  );
};
