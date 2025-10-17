import { Show, createSignal, onMount } from 'solid-js';
import { appState, setAppState, saveState, hasMultipleDates } from '../stores/appState';
import { isMobile } from '../lib/helpers/responsiveness-client';
import { Select } from './controls/Select';
import { Toggle } from './controls/Toggle';
import { DateSlider } from './controls/DateSlider';
import { AnimationControls } from './controls/AnimationControls';
import { RotationControls } from './controls/RotationControls';

const DATASETS = ['Temperature', 'Temp Anomaly'] as const;

export const ControlPanel = () => {
  const [debugOpen, setDebugOpen] = createSignal(false);
  const [menuVisible, setMenuVisible] = createSignal(true);
  const [_, setMobile] = createSignal(false);

  // Detect mobile on mount (client-side only)
  onMount(() => {
    setMobile(isMobile());
  });

  const handleDatasetChange = (value: typeof appState.dataset) => {
    setAppState('dataset', value);
    saveState();
  };

  const handleToggleRotate = () => {
    setAppState('autoRotate', !appState.autoRotate);
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

  const handleDateChange = (index: number) => {
    setAppState('currentDateIndex', index);
    // Don't save to localStorage - let user navigate freely during session
  };

  const handleStopAnimation = () => {
    if (appState.isAnimating) {
      setAppState('isAnimating', false);
    }
  };

  const handleToggleAnimation = () => {
    // If starting to play from the last frame, jump to beginning immediately
    if (!appState.isAnimating &&
        appState.currentDateIndex === appState.availableDates.length - 1) {
      setAppState('currentDateIndex', 0);
    }
    setAppState('isAnimating', !appState.isAnimating);
  };

  const handleAnimationSpeedChange = (speed: number) => {
    setAppState('animationSpeed', speed);
    saveState();
  };

  const handleReset = () => {
    localStorage.removeItem('appState');
    window.location.reload();
  };

  const toggleMenu = () => {
    setMenuVisible(!menuVisible());
  };

  return (
    <>
      <button class="menu-toggle" onClick={toggleMenu}>
        {menuVisible() ? 'Close' : 'Options'}
      </button>

      <div
        class="control-panel"
        classList={{ visible: menuVisible() }}
      >
        <div class="control-panel-header">
          <h3>Options</h3>
        </div>

        <div class="control-panel-body">
            <Select
              label="Dataset"
              value={appState.dataset}
              options={DATASETS}
              onChange={handleDatasetChange}
            />

            <DateSlider
              dates={appState.availableDates}
              currentIndex={appState.currentDateIndex}
              onDateChange={handleDateChange}
              onStopAnimation={handleStopAnimation}
              disabled={appState.isLoading}
            />

            <AnimationControls
              isAnimating={appState.isAnimating}
              animationSpeed={appState.animationSpeed}
              hasMultipleDates={hasMultipleDates()}
              onToggleAnimation={handleToggleAnimation}
              onSpeedChange={handleAnimationSpeedChange}
            />

            <RotationControls
              autoRotate={appState.autoRotate}
              rotateSpeed={appState.autoRotateSpeed}
              onToggleRotate={handleToggleRotate}
              onSpeedChange={handleAutoRotateSpeedChange}
            />

            <div class="control-section debug-section">
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
      </div>
    </>
  );
};
