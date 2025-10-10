import { Show, createSignal, onMount } from 'solid-js';
import { appState, setAppState, saveState } from '../stores/appState';
import { isMobile } from '../lib/helpers/responsiveness-client';
import { Slider } from './controls/Slider';
import { Select } from './controls/Select';
import { Toggle } from './controls/Toggle';

const DATASETS = ['Temperature', 'Temp Anomaly'] as const;

export const ControlPanel = () => {
  const [debugOpen, setDebugOpen] = createSignal(false);
  const [menuVisible, setMenuVisible] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(false);

  // Detect mobile on mount (client-side only)
  onMount(() => {
    setMobile(isMobile());

    // Load collapsed state from localStorage
    const savedCollapsed = localStorage.getItem('controlPanelCollapsed');
    if (savedCollapsed !== null) {
      setCollapsed(savedCollapsed === 'true');
    }
  });

  const handleDatasetChange = (value: typeof appState.dataset) => {
    setAppState('dataset', value);
    saveState();
    if (mobile()) {
      setMenuVisible(false);
    }
  };

  const handleAutoRotateChange = (value: boolean) => {
    setAppState('autoRotate', value);
    saveState();
  };

  const handleAutoRotateSpeedChange = (value: number) => {
    setAppState('autoRotateSpeed', value);
    saveState();
  };

  const handleShowStatsChange = (value: boolean) => {
    setAppState('showStats', value);
    saveState();
  };

  const handleShowAxesChange = (value: boolean) => {
    setAppState('showAxes', value);
    saveState();
  };

  const handleReset = () => {
    localStorage.removeItem('appState');
    window.location.reload();
  };

  const toggleMenu = () => {
    setMenuVisible(!menuVisible());
  };

  const toggleCollapsed = () => {
    const newCollapsed = !collapsed();
    setCollapsed(newCollapsed);
    localStorage.setItem('controlPanelCollapsed', String(newCollapsed));
  };

  return (
    <>
      <Show when={mobile()}>
        <button class="mobile-menu-toggle" onClick={toggleMenu}>
          {menuVisible() ? 'Close' : 'Options'}
        </button>
      </Show>

      <div
        class="control-panel"
        classList={{ visible: menuVisible() || !mobile() }}
      >
        <div class="control-panel-header">
          <h3>Options</h3>
          <button
            class="collapse-button"
            onClick={toggleCollapsed}
            aria-label={collapsed() ? 'Expand panel' : 'Collapse panel'}
          >
            <span class="chevron" classList={{ open: !collapsed() }}>
              ▼
            </span>
          </button>
        </div>

        <Show when={!collapsed()}>
          <div class="control-panel-body">
            <Select
              label="Dataset"
              value={appState.dataset}
              options={DATASETS}
              onChange={handleDatasetChange}
            />

            <Toggle
              label="Auto Rotate"
              checked={appState.autoRotate}
              onChange={handleAutoRotateChange}
            />

            <Show when={appState.autoRotate}>
              <Slider
                label="Rotate Speed"
                value={appState.autoRotateSpeed}
                min={0}
                max={5}
                step={0.1}
                onChange={handleAutoRotateSpeedChange}
              />
            </Show>

            <div class="control-section">
              <button
                class="control-section-header"
                onClick={() => setDebugOpen(!debugOpen())}
              >
                <span>🐞 Details/Debug</span>
                <span class="chevron" classList={{ open: debugOpen() }}>
                  ▼
                </span>
              </button>

              <Show when={debugOpen()}>
                <div class="control-section-content">
                  <Toggle
                    label="Show FPS Stats"
                    checked={appState.showStats}
                    onChange={handleShowStatsChange}
                  />
                  <Toggle
                    label="Show Axes"
                    checked={appState.showAxes}
                    onChange={handleShowAxesChange}
                  />
                </div>
              </Show>
            </div>

            <button class="control-reset-button" onClick={handleReset}>
              RESET
            </button>
          </div>
        </Show>
      </div>
    </>
  );
};
