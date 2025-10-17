import { onMount, onCleanup } from 'solid-js';
import { appState, setAppState } from '../stores/appState';

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

      switch (e.key.toLowerCase()) {
        case ' ': // Spacebar - play/pause animation
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
          e.preventDefault();
          if (appState.currentDateIndex > 0) {
            setAppState('currentDateIndex', appState.currentDateIndex - 1);
          }
          break;

        case 'arrowright': // Right arrow - next date
          e.preventDefault();
          if (appState.currentDateIndex < appState.availableDates.length - 1) {
            setAppState('currentDateIndex', appState.currentDateIndex + 1);
          }
          break;

        case 'r': // R - toggle rotation
          e.preventDefault();
          setAppState('autoRotate', !appState.autoRotate);
          break;

        case 't': // T - toggle dataset
          e.preventDefault();
          const newDataset = appState.dataset === 'Temperature'
            ? 'Temp Anomaly'
            : 'Temperature';
          setAppState('dataset', newDataset);
          break;

        case '?': // ? - show About popup
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('open-about-popup'));
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
