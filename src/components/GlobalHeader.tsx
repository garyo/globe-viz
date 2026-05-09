import { For } from 'solid-js';
import { appState, setAppState, saveState, type TabId } from '../stores/appState';
import { ThemeSwitcher } from './controls/ThemeSwitcher';

const TABS: { id: TabId; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'trends', label: 'Trends' },
  { id: 'about', label: 'About' },
];

const DATASETS: { id: 'Temperature' | 'Temp Anomaly'; label: string; icon: string }[] = [
  { id: 'Temperature', label: 'Temp', icon: '🌡' },
  { id: 'Temp Anomaly', label: 'Anomaly', icon: 'Δ' },
];

export const GlobalHeader = () => {
  const switchTab = (id: TabId) => {
    if (appState.activeTab === id) return;
    setAppState('activeTab', id);
    saveState();
  };

  const selectDataset = (id: typeof DATASETS[number]['id']) => {
    if (appState.dataset === id) return;
    setAppState('dataset', id);
    saveState();
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
        <div class="segmented" role="radiogroup" aria-label="Dataset">
          <For each={DATASETS}>
            {(d) => (
              <button
                type="button"
                role="radio"
                aria-checked={appState.dataset === d.id}
                aria-label={d.id}
                classList={{ active: appState.dataset === d.id }}
                onClick={() => selectDataset(d.id)}
                title={d.id}
              >
                <span class="icon">{d.icon}</span>
                <span class="label-mobile-hide">{d.label}</span>
              </button>
            )}
          </For>
        </div>

        <ThemeSwitcher />
      </div>
    </header>
  );
};
