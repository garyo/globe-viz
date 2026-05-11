import { createStore } from 'solid-js/store';
import { Color, type Texture } from 'three';

export interface Metadata {
  cmap: [number, string][];
  title: string;
  dataset: string;
  date: string;
  year: number;
  month: number;
  day: number;
}

export type TabId = 'globe' | 'trends' | 'about';
export type ThemePref = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

// Climate-data sources defined upstream in sea-surface-temp-viz/sources/.
export type SourceId = 'oisst' | 'era5';
// Raw dataset IDs as they appear in cache keys + S3 filenames + timeseries
// JSONs. OISST exposes (sst, anom); ERA5 exposes (sst, t2m). The available
// dataset list is source-specific — see DATASETS_BY_SOURCE.
export type DatasetId = 'sst' | 'anom' | 't2m';

/** Per-source list of datasets, mirroring upstream sources/{oisst,era5}.py. */
export const DATASETS_BY_SOURCE: Record<SourceId, DatasetId[]> = {
  oisst: ['sst', 'anom'],
  era5: ['sst', 't2m'],
};

/** True when this (source, dataset) combination actually exists. */
export function isValidDataset(source: SourceId, dataset: DatasetId): boolean {
  return DATASETS_BY_SOURCE[source].includes(dataset);
}

/** Fall back to the source's first dataset when the current one is invalid for it. */
export function defaultDatasetFor(source: SourceId): DatasetId {
  return DATASETS_BY_SOURCE[source][0];
}

export interface AssetSlot {
  texture: Texture | null;
  metadata: Metadata;
  source: SourceId | null;  // tracks which source this slot was loaded for
}

export interface AppState {
  // Active top-level tab
  activeTab: TabId;

  // Theme preference (resolves to effectiveTheme via system query when 'system')
  themePref: ThemePref;
  effectiveTheme: EffectiveTheme;

  // Active data source (e.g. 'oisst', 'era5'). Persisted; reconciled against
  // availableSources on load.
  source: SourceId;
  availableSources: SourceId[];

  // Per-source set of dates that actually have a texture in S3. Used to snap
  // currentDateIndex to a valid date when the user switches source, since the
  // sources have different latencies (OISST: ~2 days, ERA5: ~5–7 days).
  sourceDates: Record<SourceId, string[]>;

  // Active dataset within the source. Raw ID matching cache-key segment.
  dataset: DatasetId;

  // Globe appearance
  landColor: string;

  // Camera and rotation
  autoRotate: boolean;
  autoRotateSpeed: number;

  // Debug settings
  showStats: boolean;
  showAxes: boolean;

  // Data: per-dataset texture + metadata slots, scoped to the current source.
  // When source changes, every slot whose `source` doesn't match is reloaded.
  assets: Record<DatasetId, AssetSlot>;

  // Date/time navigation
  availableDates: string[];  // Array of 'YYYY-MM-DD' strings
  currentDateIndex: number;  // Index into availableDates array
  isAnimating: boolean;      // Whether animation is playing
  animationSpeed: number;    // Animation speed in milliseconds between frames

  // Trends tab: region selection. `availableRegions` mirrors the per-load
  // index.json's timeseries.regions[] (not persisted); `region` is the user's
  // current selection (persisted, defaults to 'global').
  region: string;
  availableRegions: string[];
  // 'single': one full-detail chart (with region selector).
  // 'grid':   small-multiples view of every available region.
  trendsMode: 'single' | 'grid';

  // Loading state
  isLoading: boolean;
  missingDateError: string | null;  // Error message if current date data is missing

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

const emptySlot = (): AssetSlot => ({
  texture: null,
  metadata: { ...defaultMetadata },
  source: null,
});

const initialState: AppState = {
  activeTab: 'globe',
  themePref: 'system',
  effectiveTheme: 'dark',
  source: 'oisst',
  availableSources: ['oisst'],
  sourceDates: { oisst: [], era5: [] },
  dataset: 'anom',
  landColor: '#aaaaaa',
  autoRotate: false,
  autoRotateSpeed: 0.5,
  showStats: false,
  showAxes: false,
  assets: {
    sst: emptySlot(),
    anom: emptySlot(),
    t2m: emptySlot(),
  },
  availableDates: [],
  currentDateIndex: 0,
  isAnimating: false,
  animationSpeed: 100, // 100ms between frames (10 fps)
  region: 'global',
  availableRegions: ['global'],
  trendsMode: 'single',
  isLoading: true,
  missingDateError: null,
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
      // Only restore UI settings, not data. Filter undefined so missing keys
      // don't clobber the defaults in initialState when spread.
      const restored: Partial<AppState> = {};
      const KEYS = [
        'activeTab',
        'themePref',
        'source',
        'dataset',
        'landColor',
        'autoRotate',
        'autoRotateSpeed',
        'showStats',
        'showAxes',
        'region',
        'trendsMode',
      ] as const;
      for (const k of KEYS) {
        if (parsed[k] !== undefined) (restored as Record<string, unknown>)[k] = parsed[k];
      }
      // Migrate legacy `dataset` values from pre-ERA5 builds.
      const legacyDataset = restored.dataset as unknown;
      if (legacyDataset === 'Temperature') restored.dataset = 'sst';
      else if (legacyDataset === 'Temp Anomaly') restored.dataset = 'anom';
      return restored;
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
      activeTab: appState.activeTab,
      themePref: appState.themePref,
      source: appState.source,
      dataset: appState.dataset,
      landColor: appState.landColor,
      autoRotate: appState.autoRotate,
      autoRotateSpeed: appState.autoRotateSpeed,
      showStats: appState.showStats,
      showAxes: appState.showAxes,
      region: appState.region,
      trendsMode: appState.trendsMode,
    };
    localStorage.setItem('appState', JSON.stringify(toSave));
  }, 500);
}

// Helper to convert hex color to Three.js Color
export function getLandColorAsThreeColor(): Color {
  return new Color(appState.landColor);
}

// Helper to get the current selected date
export function getCurrentDate(): string | undefined {
  const { availableDates, currentDateIndex } = appState;
  if (availableDates.length === 0) return undefined;
  return availableDates[currentDateIndex];
}

// Helper to check if we have multiple dates available
export function hasMultipleDates(): boolean {
  return appState.availableDates.length > 1;
}

/**
 * Resolve the user's themePref into a concrete 'light' | 'dark', consulting
 * the OS preference for 'system'. Safe to call from non-browser contexts.
 */
export function resolveTheme(pref: ThemePref): EffectiveTheme {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply the effective theme to the document and update appState.
 * Call once on app startup, and whenever themePref changes.
 */
export function applyTheme() {
  const eff = resolveTheme(appState.themePref);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = eff;
  }
  if (appState.effectiveTheme !== eff) {
    setAppState('effectiveTheme', eff);
  }
}

let systemThemeMql: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

/**
 * Begin listening for OS-level color-scheme changes; only re-applies when
 * the user is in 'system' mode. Idempotent.
 */
export function startSystemThemeWatch() {
  if (typeof window === 'undefined' || !window.matchMedia || systemThemeMql) return;
  systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeListener = () => {
    if (appState.themePref === 'system') applyTheme();
  };
  systemThemeMql.addEventListener('change', systemThemeListener);
}
