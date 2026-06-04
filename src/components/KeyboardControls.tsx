import { onMount, onCleanup } from 'solid-js';
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
} from '../stores/appState';

export const KeyboardControls = () => {
  onMount(() => {
    // Hold-to-peek state for the A key: a quick tap toggles anomaly; holding
    // shows the other mode only until release (before/after comparison).
    const PEEK_THRESHOLD_MS = 400;
    let anomalyPeek: { prior: boolean; downAt: number } | null = null;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if modifier keys are pressed (could interfere with browser shortcuts)
      if (e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      // Ignore if user is typing in a text input or textarea
      // Exception: allow spacebar when range slider (date slider) has focus
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        const isRangeInput = e.target instanceof HTMLInputElement && e.target.type === 'range';
        const isSpacebar = e.key === ' ';

        // Allow spacebar on range sliders, block everything else
        if (!(isRangeInput && isSpacebar)) {
          return;
        }
      }

      // Most keyboard shortcuts are globe-specific. The About shortcut is
      // available everywhere.
      const onGlobeTab = appState.activeTab === 'globe';

      switch (e.key.toLowerCase()) {
        case ' ': // Spacebar - play/pause animation
          if (!onGlobeTab) return;
          e.preventDefault();
          if (appState.availableDates.length > 1) {
            // If starting to play from the last frame, jump to beginning
            if (!appState.isAnimating &&
                appState.currentDateIndex === appState.availableDates.length - 1) {
              setAppState('currentDateIndex', 0);
            }
            setAppState('isAnimating', !appState.isAnimating);
          }
          break;

        case 'arrowleft': // Left arrow - previous date
          if (!onGlobeTab) return;
          e.preventDefault();
          if (appState.currentDateIndex > 0) {
            setAppState('currentDateIndex', appState.currentDateIndex - 1);
          }
          break;

        case 'arrowright': // Right arrow - next date
          if (!onGlobeTab) return;
          e.preventDefault();
          if (appState.currentDateIndex < appState.availableDates.length - 1) {
            setAppState('currentDateIndex', appState.currentDateIndex + 1);
          }
          break;

        case 'r': // R - toggle rotation
          if (!onGlobeTab) return;
          e.preventDefault();
          setAppState('autoRotate', !appState.autoRotate);
          break;

        case 'a': { // A - toggle actual/anomaly (hold to peek)
          if (e.repeat) return; // one flip per press, not rapid cycling
          e.preventDefault();
          const prior = anomalyOf(appState.dataset);
          anomalyPeek = { prior, downAt: performance.now() };
          applyView(appState.source, variableOf(appState.dataset), !prior);
          break;
        }

        case 'v': { // V - cycle variable (sea temp / air temp)
          e.preventDefault();
          const vars = allVariables();
          if (vars.length < 2) return;
          const next = vars[(vars.indexOf(variableOf(appState.dataset)) + 1) % vars.length];
          selectVariable(next);
          break;
        }

        case 's': { // S - cycle source for the current variable
          e.preventDefault();
          const variable = variableOf(appState.dataset);
          const sources = sourcesFor(variable);
          if (sources.length < 2) return;
          const next = sources[(sources.indexOf(appState.source) + 1) % sources.length];
          applyView(next, variable, anomalyOf(appState.dataset));
          break;
        }

        case '?': // ? - open About tab
          e.preventDefault();
          setAppState('activeTab', 'about');
          saveState();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'a' || !anomalyPeek) return;
      // Held long enough to be a peek: snap back to the prior mode.
      if (performance.now() - anomalyPeek.downAt > PEEK_THRESHOLD_MS) {
        applyView(appState.source, variableOf(appState.dataset), anomalyPeek.prior);
      }
      anomalyPeek = null;
    };

    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('keyup', handleKeyUp);
    });
  });

  return null;
};
