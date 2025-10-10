import { createStore } from 'solid-js/store';
import { Color } from 'three';

export interface Metadata {
  cmap: [number, string][];
  title: string;
  dataset: string;
  date: string;
  year: number;
  month: number;
  day: number;
}

export interface AppState {
  // Dataset selection
  dataset: 'Temperature' | 'Temp Anomaly';

  // Globe appearance
  landColor: string;

  // Camera and rotation
  autoRotate: boolean;
  autoRotateSpeed: number;

  // Debug settings
  showStats: boolean;
  showAxes: boolean;

  // Data
  assets: {
    sstTexture: Blob | null;
    sstMetadata: Metadata;
    sstAnomalyTexture: Blob | null;
    sstAnomalyMetadata: Metadata;
  };

  // Loading state
  isLoading: boolean;

  // Mobile UI
  mobileMenuOpen: boolean;
}

const defaultMetadata: Metadata = {
  cmap: [],
  title: '',
  dataset: '',
  date: '',
  year: 0,
  month: 0,
  day: 0,
};

const initialState: AppState = {
  dataset: 'Temp Anomaly',
  landColor: '#aaaaaa',
  autoRotate: false,
  autoRotateSpeed: 0.5,
  showStats: false,
  showAxes: false,
  assets: {
    sstTexture: null,
    sstMetadata: { ...defaultMetadata },
    sstAnomalyTexture: null,
    sstAnomalyMetadata: { ...defaultMetadata },
  },
  isLoading: true,
  mobileMenuOpen: false,
};

/**
 * Loads saved application state from localStorage.
 * SSR-safe: Returns empty object during server-side rendering when localStorage is unavailable.
 * @returns Partial application state with user preferences
 */
function loadSavedState(): Partial<AppState> {
  // SSR guard: Check if we're in the browser (not SSR)
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {};
  }

  const saved = localStorage.getItem('appState');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Only restore UI settings, not data
      return {
        dataset: parsed.dataset,
        landColor: parsed.landColor,
        autoRotate: parsed.autoRotate,
        autoRotateSpeed: parsed.autoRotateSpeed,
        showStats: parsed.showStats,
        showAxes: parsed.showAxes,
      };
    } catch (e) {
      console.error('Failed to load saved state:', e);
    }
  }
  return {};
}

const savedState = loadSavedState();

export const [appState, setAppState] = createStore<AppState>({
  ...initialState,
  ...savedState,
});

/**
 * Saves application state to localStorage with debouncing.
 * SSR-safe: No-op during server-side rendering when localStorage is unavailable.
 * Debounced by 500ms to avoid excessive writes.
 */
let saveTimeout: number | undefined;
export function saveState() {
  // SSR guard: Check if we're in the browser (not SSR)
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    const toSave = {
      dataset: appState.dataset,
      landColor: appState.landColor,
      autoRotate: appState.autoRotate,
      autoRotateSpeed: appState.autoRotateSpeed,
      showStats: appState.showStats,
      showAxes: appState.showAxes,
    };
    localStorage.setItem('appState', JSON.stringify(toSave));
  }, 500);
}

// Helper to convert hex color to Three.js Color
export function getLandColorAsThreeColor(): Color {
  return new Color(appState.landColor);
}
