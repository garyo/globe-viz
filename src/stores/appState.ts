import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Color, type Texture } from 'three';
import { readUrlState } from '../lib/url-state';

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
export type SourceId = 'oisst' | 'era5' | 'gfs';

export const SOURCE_LABELS: Record<SourceId, { short: string; full: string }> = {
  oisst: { short: 'OISST', full: 'NOAA OISST' },
  era5: { short: 'ERA5', full: 'ECMWF ERA5' },
  gfs: { short: 'GFS', full: 'NOAA GFS (near-real-time)' },
};
// Raw dataset IDs as they appear in cache keys + S3 filenames + timeseries
// JSONs. OISST: sst, anom. ERA5: sst, sst_anom, t2m, t2m_anom. GFS carries 2 m
// air temp along a min/mean/max statistic axis (t2m_{mean,max,min}[_anom]). The
// available dataset list is source-specific — see DATASETS_BY_SOURCE.
export type DatasetId =
  | 'sst'
  | 'anom'
  | 'sst_anom'
  | 't2m'
  | 't2m_anom'
  | 't2m_mean'
  | 't2m_max'
  | 't2m_min'
  | 't2m_mean_anom'
  | 't2m_max_anom'
  | 't2m_min_anom';

/** Per-source list of datasets, mirroring upstream sources/{oisst,era5,gfs}.py. */
export const DATASETS_BY_SOURCE: Record<SourceId, DatasetId[]> = {
  oisst: ['sst', 'anom'],
  era5: ['sst', 'sst_anom', 't2m', 't2m_anom'],
  gfs: [
    't2m_mean', 't2m_max', 't2m_min',
    't2m_mean_anom', 't2m_max_anom', 't2m_min_anom',
  ],
};

// GFS exposes a daily reduction (statistic) axis that the other sources lack:
// the same air-temp field as a daily mean, max, or min. It's a third orthogonal
// decomposition of the DatasetId — like `anomaly` — so the data flow (cache
// keys, filenames, timeseries) is unchanged; only the header gains a button
// group. Sources without the axis return [] and the group stays hidden.
export type StatisticId = 'mean' | 'max' | 'min';

// Display order for the statistic axis: cold → hot (Min, Mean, Max).
export const STATISTIC_ORDER: StatisticId[] = ['min', 'mean', 'max'];

// The statistic axis only exists for air temp, and is ragged across sources:
// ERA5 provides a daily mean only; GFS provides the full min/mean/max; sea-
// surface temp has no statistic axis anywhere. This (with DATASETS_BY_SOURCE)
// is the single source of truth for the capability grid the legend renders.
export function statisticsForSourceVariable(source: SourceId, variable: Variable): StatisticId[] {
  if (variable !== 't2m') return [];
  if (source === 'gfs') return ['mean', 'max', 'min'];
  if (source === 'era5') return ['mean'];
  return [];
}

/** Statistics offered for a variable by ANY available source — the buttons to
 * show (air temp → mean/max/min; sea temp → none). */
export function statisticsForVariable(variable: Variable): StatisticId[] {
  return STATISTIC_ORDER.filter((stat) =>
    appState.availableSources.some((s) =>
      statisticsForSourceVariable(s, variable).includes(stat),
    ),
  );
}

/** The statistic encoded in a dataset id, or null for sources without the axis. */
export function statisticOf(d: DatasetId): StatisticId | null {
  if (d.startsWith('t2m_mean')) return 'mean';
  if (d.startsWith('t2m_max')) return 'max';
  if (d.startsWith('t2m_min')) return 'min';
  return null;
}

/** The statistic the current view represents — treats ERA5's plain `t2m` (no
 * token) as the daily mean so the legend highlights the right cell. */
export function effectiveStatistic(source: SourceId, dataset: DatasetId): StatisticId | null {
  return (
    statisticOf(dataset)
    ?? (statisticsForSourceVariable(source, variableOf(dataset)).length ? 'mean' : null)
  );
}

/** Does this source offer this variable at all? (OISST: no air; GFS: no sea.) */
export function sourceHasVariable(source: SourceId, variable: Variable): boolean {
  return datasetFor(source, variable, false) !== null;
}

/** True when this (source, dataset) combination actually exists. */
export function isValidDataset(source: SourceId, dataset: DatasetId): boolean {
  return DATASETS_BY_SOURCE[source].includes(dataset);
}

/** Fall back to the source's first dataset when the current one is invalid for it. */
export function defaultDatasetFor(source: SourceId): DatasetId {
  return DATASETS_BY_SOURCE[source][0];
}

// The dataset axis decomposes into two orthogonal user choices: which
// variable (sea-surface temp vs. 2 m air temp) and whether to view the raw
// value vs. its anomaly against the 1971-2000 climatology. The UI presents
// these as a variable selector + anomaly checkbox; we map back to a raw
// DatasetId at the boundary so the rest of the data flow (cache keys,
// texture filenames, timeseries JSON) stays unchanged.
export type Variable = 'sst' | 't2m';

/** Decompose a raw DatasetId into (variable, anomaly). */
export function variableOf(d: DatasetId): Variable {
  return d.startsWith('t2m') ? 't2m' : 'sst';
}
export function anomalyOf(d: DatasetId): boolean {
  return d === 'anom' || d.endsWith('_anom');
}

/** Compose a raw DatasetId from (source, variable, anomaly[, statistic]), or
 * null if that combination doesn't exist for this source. `statistic` only
 * applies to sources with a statistic axis (GFS); others ignore it. */
export function datasetFor(
  source: SourceId,
  variable: Variable,
  anomaly: boolean,
  statistic?: StatisticId,
): DatasetId | null {
  let candidate: DatasetId;
  if (source === 'gfs') {
    // GFS only carries 2 m air temp, along a min/mean/max statistic axis.
    if (variable !== 't2m') return null;
    candidate = `t2m_${statistic ?? 'mean'}${anomaly ? '_anom' : ''}` as DatasetId;
  } else if (variable === 'sst') {
    if (!anomaly) candidate = 'sst';
    else candidate = source === 'oisst' ? 'anom' : 'sst_anom';
  } else {
    // Non-GFS air temp (ERA5) is a daily mean only — reject explicit max/min.
    if (statistic && statistic !== 'mean') return null;
    candidate = anomaly ? 't2m_anom' : 't2m';
  }
  return isValidDataset(source, candidate) ? candidate : null;
}

/** Which available sources offer this variable (drives the source picker). */
export function sourcesFor(variable: Variable): SourceId[] {
  return appState.availableSources.filter((s) => datasetFor(s, variable, false) !== null);
}

/** All variables offered by any available source (drives the variable
 * selector — every variable is always visible; picking one hops source if
 * needed, see selectVariable). */
export function allVariables(): Variable[] {
  return (['sst', 't2m'] as Variable[]).filter((v) => sourcesFor(v).length > 0);
}

/** Whether anomaly is available for this (source, variable). */
export function hasAnomalyFor(source: SourceId, variable: Variable): boolean {
  return datasetFor(source, variable, true) !== null;
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

  // Per-(source, dataset) set of dates that actually have a texture in S3,
  // when index.json exposes that granularity. Anomaly variants lag their base
  // variable (and historically weren't backfilled), so the same date can have
  // an SST texture but no SST-anomaly texture. Used to snap the date when the
  // user switches into a dataset that lacks the current date. Falls back to
  // sourceDates / availableDates for older index.json shapes.
  datasetDates: Record<SourceId, Partial<Record<DatasetId, string[]>>>;

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

  // Transient toast (e.g. "date adjusted" on source switch). Auto-cleared by
  // showNotice; never persisted.
  notice: string | null;

  // Mobile UI
  mobileMenuOpen: boolean;

  // Whether the floating "Datasets" panel is open. Shared so the header's
  // current-view chip can open the same panel the FAB toggles. Transient.
  datasetsPanelOpen: boolean;
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
  sourceDates: { oisst: [], era5: [], gfs: [] },
  datasetDates: { oisst: {}, era5: {}, gfs: {} },
  dataset: 'anom',
  landColor: '#aaaaaa',
  autoRotate: false,
  autoRotateSpeed: 0.5,
  showStats: false,
  showAxes: false,
  assets: {
    sst: emptySlot(),
    anom: emptySlot(),
    sst_anom: emptySlot(),
    t2m: emptySlot(),
    t2m_anom: emptySlot(),
    t2m_mean: emptySlot(),
    t2m_max: emptySlot(),
    t2m_min: emptySlot(),
    t2m_mean_anom: emptySlot(),
    t2m_max_anom: emptySlot(),
    t2m_min_anom: emptySlot(),
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
  notice: null,
  mobileMenuOpen: false,
  datasetsPanelOpen: false,
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
// URL params take precedence over localStorage so a shared link always wins.
// `pendingUrlDate` is split out — it needs availableDates to resolve to an
// index, which happens later in AppLoader.
const { pendingUrlDate, ...urlState } = readUrlState();

/**
 * Date selected via ?date= in the URL, awaiting resolution against
 * availableDates. Consumed (and cleared) by AppLoader once the date list
 * is loaded. Undefined when the URL didn't specify a date.
 */
export let pendingDateFromUrl: string | undefined = pendingUrlDate;
export function consumePendingDateFromUrl(): string | undefined {
  const d = pendingDateFromUrl;
  pendingDateFromUrl = undefined;
  return d;
}

export const [appState, setAppState] = createStore<AppState>({
  ...initialState,
  ...savedState,
  ...urlState,
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
  // URL sync is handled by a reactive effect in AppLoader so it picks up
  // every relevant change (including date scrubbing, which intentionally
  // bypasses saveState).
}

/**
 * Switch the globe view to (source, variable, anomaly) in one step,
 * reconciling everything downstream: falls back to the raw dataset when the
 * anomaly variant doesn't exist, and snaps the current date when the new
 * source doesn't cover it (sources differ in latency). Header controls and
 * keyboard shortcuts both go through here.
 */
/** Commit a concrete (source, dataset), snapping the date and optionally
 * surfacing a capability-driven adjustment via the notice toast (e.g. "OISST
 * has no air temp — showing sea-surface temp"). The single low-level mutator
 * every selector routes through. */
function commitView(source: SourceId, dataset: DatasetId, reason?: string) {
  // Batch so effects watching (source, dataset, date) never observe a
  // half-applied combination — e.g. era5 + oisst's 'anom' — and fire a
  // doomed fetch for it.
  batch(() => {
    if (source !== appState.source) setAppState('source', source);
    if (dataset !== appState.dataset) setAppState('dataset', dataset);
    // Snap after both are applied so we check against the new (source, dataset).
    snapDateToSelection(source, dataset);
  });
  if (reason) showNotice(reason);
  saveState();
}

export function applyView(
  source: SourceId,
  variable: Variable,
  anomaly: boolean,
  statistic?: StatisticId,
) {
  // Preserve the current statistic when the caller doesn't specify one (e.g.
  // toggling anomaly keeps you on max/min); fall back toward the daily mean
  // when the target source lacks the requested statistic.
  const stat = statistic ?? effectiveStatistic(appState.source, appState.dataset) ?? 'mean';
  const dataset =
    datasetFor(source, variable, anomaly, stat)
    ?? datasetFor(source, variable, false, stat)
    ?? datasetFor(source, variable, anomaly, 'mean')
    ?? datasetFor(source, variable, false, 'mean');
  if (!dataset) return; // source doesn't offer this variable at all
  commitView(source, dataset);
}

/** Human label for a variable, used in explain-on-change notices. */
function variableWord(variable: Variable): string {
  return variable === 't2m' ? 'air' : 'sea-surface';
}

/** Pick a variable, hopping source when the current one doesn't offer it
 * (e.g. Air Temp implies ERA5/GFS). Keeps the anomaly mode + statistic where
 * possible. */
export function selectVariable(variable: Variable) {
  if (variableOf(appState.dataset) === variable) return;
  const sources = sourcesFor(variable);
  if (sources.length === 0) return;
  const source = sources.includes(appState.source) ? appState.source : sources[0];
  applyView(source, variable, anomalyOf(appState.dataset));
}

/** Switch source without ever dead-ending: keep as much of the current view
 * (variable, statistic, anomaly) as the target offers, and explain whatever
 * had to change. This is what makes every source always clickable for quick
 * A/B comparison. */
export function selectSource(target: SourceId) {
  if (target === appState.source) return;
  const variable = variableOf(appState.dataset);
  const anomaly = anomalyOf(appState.dataset);
  const stat = effectiveStatistic(appState.source, appState.dataset) ?? 'mean';

  // 1. Same variable + statistic available on the target → clean switch.
  let ds = datasetFor(target, variable, anomaly, stat) ?? datasetFor(target, variable, false, stat);
  if (ds) return commitView(target, ds);

  // 2. Target has the variable but not this statistic (ERA5 ← GFS max/min).
  if (sourceHasVariable(target, variable)) {
    ds = datasetFor(target, variable, anomaly, 'mean') ?? datasetFor(target, variable, false, 'mean');
    if (ds) {
      return commitView(target, ds, `${SOURCE_LABELS[target].short} air temp is daily-mean only`);
    }
  }

  // 3. Target lacks the variable entirely → switch to its other variable.
  const other: Variable = variable === 't2m' ? 'sst' : 't2m';
  ds = datasetFor(target, other, anomaly) ?? datasetFor(target, other, false);
  const otherWord = variableWord(other) === 'air' ? 'air temp' : 'sea-surface temp';
  if (ds) {
    return commitView(
      target,
      ds,
      `${SOURCE_LABELS[target].short} has no ${variableWord(variable)} temp — showing ${otherWord}`,
    );
  }

  // 4. Last resort: the source's default dataset.
  commitView(target, defaultDatasetFor(target));
}

/** Pick a statistic, hopping source when the current one doesn't offer it
 * (Max/Min imply GFS). Keeps variable + anomaly. */
export function selectStatistic(stat: StatisticId) {
  const variable = variableOf(appState.dataset);
  const anomaly = anomalyOf(appState.dataset);
  if (statisticsForSourceVariable(appState.source, variable).includes(stat)) {
    return applyView(appState.source, variable, anomaly, stat);
  }
  // Hop to a source that offers this statistic (GFS for max/min).
  const target = appState.availableSources.find((s) =>
    statisticsForSourceVariable(s, variable).includes(stat),
  );
  if (!target) return;
  applyView(target, variable, anomaly, stat);
  showNotice(`Daily ${stat} is ${SOURCE_LABELS[target].short} only`);
}

/** Dates that actually have a texture for this (source, dataset). Prefers the
 * per-dataset breakdown from index.json, falling back to the source-level set
 * and finally the union — so older index.json shapes still work. */
export function datesForSelection(source: SourceId, dataset: DatasetId): string[] {
  return (
    appState.datasetDates[source]?.[dataset]
    ?? appState.sourceDates[source]
    ?? appState.availableDates
  );
}

/** Whether (source, dataset) actually has textures published. Distinguishes a
 * capability that exists in code from one with data on S3 yet — e.g. GFS
 * max/min anomalies exist as a concept but aren't built until their ERA5
 * climatologies land. When the index carries no per-dataset breakdown for the
 * source at all, assume present (older index shapes). */
export function hasTextureData(source: SourceId, dataset: DatasetId): boolean {
  const map = appState.datasetDates[source];
  if (!map || Object.keys(map).length === 0) return true;
  const dates = map[dataset];
  return dates ? dates.length > 0 : false;
}

/** Human-readable name for a (source, dataset) pair, for date-snap notices. */
function selectionLabel(source: SourceId, dataset: DatasetId): string {
  const variable = variableOf(dataset) === 't2m' ? 'air temp' : 'SST';
  const stat = statisticOf(dataset);
  const statLabel = stat ? ` ${stat}` : '';
  const anom = anomalyOf(dataset) ? ' anomaly' : '';
  return `${SOURCE_LABELS[source].short}${statLabel} ${variable}${anom}`;
}

/** Snap currentDateIndex to the nearest date the (source, dataset) has
 * (≤ current, else its latest), telling the user when it moves. */
function snapDateToSelection(source: SourceId, dataset: DatasetId) {
  const dates = datesForSelection(source, dataset);
  if (!dates || dates.length === 0) return;
  const currentDate = appState.availableDates[appState.currentDateIndex];
  if (!currentDate || dates.includes(currentDate)) return;
  // findLast not in all TS lib targets; walk the (sorted) array.
  let candidate: string | undefined;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= currentDate) { candidate = dates[i]; break; }
  }
  const snapDate = candidate ?? dates[dates.length - 1];
  const idx = appState.availableDates.indexOf(snapDate);
  if (idx >= 0 && idx !== appState.currentDateIndex) {
    setAppState('currentDateIndex', idx);
    showNotice(`${selectionLabel(source, dataset)} has no data for ${currentDate} — showing ${snapDate}`);
  }
}

let noticeTimeout: number | undefined;
export function showNotice(message: string) {
  setAppState('notice', message);
  if (noticeTimeout) clearTimeout(noticeTimeout);
  noticeTimeout = window.setTimeout(() => setAppState('notice', null), 4000);
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
  return selectableDates().length > 1;
}

/** Dates the date slider, arrow keys, and animation iterate for the current
 * (source, dataset). A subset of availableDates: the same calendar day can
 * have a base-variable texture but not its anomaly, and a dataset's latest can
 * lag the union latest, so navigation is scoped to what actually has a texture
 * — otherwise scrubbing/playing onto a missing date 403s and stalls. */
export function selectableDates(): string[] {
  return datesForSelection(appState.source, appState.dataset);
}

/** Position of the current date within selectableDates(). If the current date
 * isn't in the set (transient, before a snap), returns the nearest earlier
 * date's index, else the last. */
export function currentSelectableIndex(): number {
  const dates = selectableDates();
  if (dates.length === 0) return 0;
  const cur = getCurrentDate();
  if (!cur) return dates.length - 1;
  const i = dates.indexOf(cur);
  if (i >= 0) return i;
  for (let k = dates.length - 1; k >= 0; k--) {
    if (dates[k] <= cur) return k;
  }
  return 0;
}

/** Move the current date to selectableDates()[i] (clamped), translating to the
 * union index (currentDateIndex) the rest of the app navigates by. */
export function setSelectableIndex(i: number): void {
  const dates = selectableDates();
  if (dates.length === 0) return;
  const date = dates[Math.max(0, Math.min(i, dates.length - 1))];
  const idx = appState.availableDates.indexOf(date);
  if (idx >= 0) setAppState('currentDateIndex', idx);
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
