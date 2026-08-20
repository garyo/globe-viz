import { Show, createSignal, onMount } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  hasMultipleDates,
  selectableDates,
  currentSelectableIndex,
  setSelectableIndex,
  loopStartIndex,
  getCurrentDate,
  showNotice,
} from '../stores/appState';
import { isMobile } from '../lib/helpers/responsiveness-client';
import { buildShareUrl } from '../lib/url-state';
import { currentCameraOrbit } from '../lib/scene/camera';
import { copyText } from '../lib/helpers/clipboard';
import { Toggle } from './controls/Toggle';
import { DateSlider } from './controls/DateSlider';
import { AnimationControls } from './controls/AnimationControls';
import { RotationControls } from './controls/RotationControls';
import { QuickDateSlider } from './controls/QuickDateSlider';

export const ControlPanel = () => {
  const [debugOpen, setDebugOpen] = createSignal(false);
  const [menuVisible, setMenuVisible] = createSignal(true);

  // On phones the open panel covers most of the globe — start closed there
  // (the quick date slider takes over). Client-side only, hence onMount.
  onMount(() => {
    if (isMobile()) setMenuVisible(false);
  });

  const toggleMenu = () => {
    setMenuVisible(!menuVisible());
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
    // index is into selectableDates() (the slider's domain), not the union.
    setSelectableIndex(index);
    // Don't save to localStorage - let user navigate freely during session
  };

  const handleStopAnimation = () => {
    if (appState.isAnimating) {
      setAppState('isAnimating', false);
    }
  };

  const handleToggleAnimation = () => {
    // If starting to play from the last frame, jump to the loop start
    if (!appState.isAnimating &&
        currentSelectableIndex() === selectableDates().length - 1) {
      setSelectableIndex(loopStartIndex());
    }
    setAppState('isAnimating', !appState.isAnimating);
  };

  const handleSetLoopStart = () => {
    setAppState('loopStartDate', getCurrentDate() ?? null);
  };

  const handleClearLoopStart = () => {
    setAppState('loopStartDate', null);
  };

  const handleAnimationSpeedChange = (speed: number) => {
    setAppState('animationSpeed', speed);
    saveState();
  };

  // Copy a link reproducing this exact view: camera framing, dataset, dates,
  // and animation settings. When parked on the latest date, the link omits it
  // (buildShareUrl) so a recipient's animation runs through *their* latest.
  const handleShare = async () => {
    const dates = selectableDates();
    const url = buildShareUrl({
      activeTab: appState.activeTab,
      source: appState.source,
      dataset: appState.dataset,
      region: appState.region,
      trendsMode: appState.trendsMode,
      currentDate: getCurrentDate(),
      latestDate: dates[dates.length - 1],
      loopStartDate: appState.loopStartDate,
      camera: currentCameraOrbit() ?? undefined,
      fps: 1000 / appState.animationSpeed,
    });
    const ok = await copyText(url);
    showNotice(ok ? 'Link copied — reproduces this view & animation' : 'Could not copy link');
  };

  const handleReset = () => {
    localStorage.removeItem('appState');
    window.location.reload();
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
            <DateSlider
              dates={selectableDates()}
              currentIndex={currentSelectableIndex()}
              loopStartIndex={loopStartIndex()}
              onDateChange={handleDateChange}
              onStopAnimation={handleStopAnimation}
              disabled={appState.isLoading}
            />

            <AnimationControls
              isAnimating={appState.isAnimating}
              animationSpeed={appState.animationSpeed}
              hasMultipleDates={hasMultipleDates()}
              loopStartDate={appState.loopStartDate}
              onToggleAnimation={handleToggleAnimation}
              onSpeedChange={handleAnimationSpeedChange}
              onSetLoopStart={handleSetLoopStart}
              onClearLoopStart={handleClearLoopStart}
            />

            <div class="control-row">
              <button
                class="control-button"
                onClick={() => void handleShare()}
                title="Copy a link that reproduces this exact view, dates, and animation"
              >
                🔗 Copy share link
              </button>
            </div>

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

      <QuickDateSlider
        dates={selectableDates()}
        currentIndex={currentSelectableIndex()}
        loopStartIndex={loopStartIndex()}
        isAnimating={appState.isAnimating}
        onDateChange={handleDateChange}
        onToggleAnimation={handleToggleAnimation}
        onStopAnimation={handleStopAnimation}
        disabled={appState.isLoading}
        visible={!menuVisible()}
      />
    </>
  );
};
