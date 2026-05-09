import { For, createEffect } from 'solid-js';
import {
  appState,
  setAppState,
  saveState,
  applyTheme,
  startSystemThemeWatch,
  type ThemePref,
} from '../../stores/appState';

const OPTIONS: { id: ThemePref; label: string; icon: string; aria: string }[] = [
  { id: 'light', label: 'Light', icon: '☀', aria: 'Use light theme' },
  { id: 'dark', label: 'Dark', icon: '☾', aria: 'Use dark theme' },
  { id: 'system', label: 'Auto', icon: '⚙', aria: 'Follow system theme' },
];

export const ThemeSwitcher = () => {
  // Begin watching for system theme changes (only takes effect when 'system'
  // is selected). Idempotent across remounts.
  startSystemThemeWatch();

  // Apply theme any time the preference changes.
  createEffect(() => {
    void appState.themePref;
    applyTheme();
  });

  const select = (id: ThemePref) => {
    if (appState.themePref === id) return;
    setAppState('themePref', id);
    saveState();
  };

  return (
    <div class="segmented" role="radiogroup" aria-label="Theme">
      <For each={OPTIONS}>
        {(opt) => (
          <button
            type="button"
            role="radio"
            aria-checked={appState.themePref === opt.id}
            aria-label={opt.aria}
            classList={{ active: appState.themePref === opt.id }}
            onClick={() => select(opt.id)}
            title={opt.aria}
          >
            <span class="icon">{opt.icon}</span>
            <span class="label-mobile-hide">{opt.label}</span>
          </button>
        )}
      </For>
    </div>
  );
};
