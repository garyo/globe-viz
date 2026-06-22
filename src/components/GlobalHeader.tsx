import { For, Show } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  variableOf,
  anomalyOf,
  effectiveStatistic,
  SOURCE_LABELS,
  type TabId,
} from '../stores/appState';
import { ThemeSwitcher } from './controls/ThemeSwitcher';

const TABS: { id: TabId; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'trends', label: 'Trends' },
  { id: 'about', label: 'About' },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Data selection (source / variable / statistic / anomaly) lives entirely in
// the floating "Datasets" panel (AvailabilityFab) now — the header is just
// brand, tabs, theme, and a read-only current-view chip that opens that panel.
export const GlobalHeader = () => {
  const switchTab = (id: TabId) => {
    if (appState.activeTab === id) return;
    setAppState('activeTab', id);
    saveState();
  };

  // Compact "what am I viewing" summary, e.g. "GFS · Air Temp · Max · Δ".
  const viewLabel = (): string => {
    const src = SOURCE_LABELS[appState.source].short;
    const v = variableOf(appState.dataset);
    const parts = [src, v === 't2m' ? 'Air Temp' : 'Sea Temp'];
    const stat = effectiveStatistic(appState.source, appState.dataset);
    if (stat) parts.push(cap(stat));
    if (anomalyOf(appState.dataset)) parts.push('Δ');
    return parts.join(' · ');
  };

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
        {/* Read-out of the current view; click to open the Datasets panel. */}
        <Show when={appState.activeTab !== 'about'}>
          <button
            type="button"
            class="view-chip"
            classList={{ active: appState.datasetsPanelOpen }}
            aria-haspopup="dialog"
            aria-expanded={appState.datasetsPanelOpen}
            onClick={() => setAppState('datasetsPanelOpen', !appState.datasetsPanelOpen)}
            title="Change dataset"
          >
            <span class="view-chip-icon" aria-hidden="true">▦</span>
            <span class="view-chip-label">{viewLabel()}</span>
          </button>
        </Show>

        <ThemeSwitcher />
      </div>

      <Show when={appState.notice}>
        <div class="header-notice" role="status">{appState.notice}</div>
      </Show>
    </header>
  );
};
