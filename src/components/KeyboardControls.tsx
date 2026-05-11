import { onMount, onCleanup } from 'solid-js';
import { appState, setAppState, saveState, DATASETS_BY_SOURCE } from '../stores/appState';

export const KeyboardControls = () => {
  onMount(() => {
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

        case 't': { // T - toggle dataset within the current source
          e.preventDefault();
          const datasets = DATASETS_BY_SOURCE[appState.source];
          const idx = datasets.indexOf(appState.dataset);
          const next = datasets[(idx + 1) % datasets.length];
          setAppState('dataset', next);
          saveState();
          break;
        }

        case '?': // ? - open About tab
          e.preventDefault();
          setAppState('activeTab', 'about');
          saveState();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);

    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyPress);
    });
  });

  return null;
};
