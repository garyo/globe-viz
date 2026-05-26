/**
 * Shareable-URL persistence for the data-related slice of appState.
 *
 * The data view that matters for "send a colleague this exact chart" is:
 *   - tab        — globe | trends | about
 *   - source     — oisst | era5
 *   - dataset    — raw cache-key dataset id (sst/anom/sst_anom/t2m/t2m_anom)
 *   - region     — global, nino_3_4, ... (only meaningful on Trends)
 *   - mode       — single | grid       (only meaningful on Trends)
 *   - date       — YYYY-MM-DD          (only meaningful on Globe)
 *
 * URL > localStorage > defaults. Writes use history.replaceState so the
 * URL bar updates in place without leaking the data-state churn into the
 * browser's back-stack.
 *
 * Theme/auto-rotate/etc. stay in localStorage only — they're personal
 * preferences, not part of the chart being shared.
 */
import type { AppState, DatasetId, SourceId, TabId } from '../stores/appState';

const VALID_TAB: TabId[] = ['globe', 'trends', 'about'];
const VALID_SRC: SourceId[] = ['oisst', 'era5'];
const VALID_DS: DatasetId[] = ['sst', 'anom', 'sst_anom', 't2m', 't2m_anom'];
const VALID_MODE = ['single', 'grid'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse URL query into a partial AppState. `date` is left to the caller to
 * apply once `availableDates` is loaded — it's returned as a sentinel field
 * named `pendingUrlDate` so the loader can resolve it post-hydration.
 */
export function readUrlState(): Partial<AppState> & { pendingUrlDate?: string } {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const out: Partial<AppState> & { pendingUrlDate?: string } = {};

  const tab = p.get('tab');
  if (tab && (VALID_TAB as string[]).includes(tab)) out.activeTab = tab as TabId;

  const src = p.get('src');
  if (src && (VALID_SRC as string[]).includes(src)) out.source = src as SourceId;

  const ds = p.get('ds');
  if (ds && (VALID_DS as string[]).includes(ds)) out.dataset = ds as DatasetId;

  const region = p.get('region');
  if (region) out.region = region;

  const mode = p.get('mode');
  if (mode && (VALID_MODE as readonly string[]).includes(mode)) {
    out.trendsMode = mode as 'single' | 'grid';
  } else if (p.get('region')) {
    // A URL that names a region implies single-region mode — the region
    // picker has no effect in grid. Without this default, a recipient whose
    // localStorage was last set to grid would land on grid and the region
    // param would silently do nothing.
    out.trendsMode = 'single';
  }

  const date = p.get('date');
  if (date && DATE_RE.test(date)) out.pendingUrlDate = date;

  return out;
}

/**
 * Resolve a `pendingUrlDate` against the loaded availableDates and return
 * the matching index, or undefined if the date isn't in the list.
 */
export function resolveUrlDate(
  date: string | undefined,
  availableDates: string[],
): number | undefined {
  if (!date) return undefined;
  const idx = availableDates.indexOf(date);
  return idx >= 0 ? idx : undefined;
}

interface UrlStateInput {
  activeTab: TabId;
  source: SourceId;
  dataset: DatasetId;
  region: string;
  trendsMode: 'single' | 'grid';
  currentDate?: string;
}

/**
 * Serialize the data slice to a query string and replace the current URL.
 * Omits irrelevant params per tab to keep URLs short:
 *   - region/mode only on Trends tab
 *   - date only on Globe tab
 */
export function writeUrlState(s: UrlStateInput): void {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams();
  p.set('tab', s.activeTab);
  p.set('src', s.source);
  p.set('ds', s.dataset);
  if (s.activeTab === 'trends') {
    // mode is always emitted on trends tab so a shared URL deterministically
    // selects single vs grid — if we dropped mode=single the recipient's
    // localStorage could pin them to grid and the region param would no-op.
    p.set('mode', s.trendsMode);
    if (s.region && s.region !== 'global') p.set('region', s.region);
  } else if (s.activeTab === 'globe') {
    if (s.currentDate) p.set('date', s.currentDate);
  }
  const url = `${window.location.pathname}?${p.toString()}${window.location.hash}`;
  // replaceState rather than pushState so dragging the date slider doesn't
  // create 100 back-stack entries.
  window.history.replaceState(null, '', url);
}
