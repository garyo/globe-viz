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
 *   - from       — YYYY-MM-DD          playback loop start (Globe only)
 *   - cam        — lat,lon,zoom        camera framing (share links only)
 *   - fps        — animation speed     (share links only)
 *
 * URL > localStorage > defaults. Writes use history.replaceState so the
 * URL bar updates in place without leaking the data-state churn into the
 * browser's back-stack.
 *
 * `cam` and `fps` are read on load but only ever *written* by buildShareUrl
 * (the Copy-share-link button) — syncing the camera into the URL bar live
 * would churn replaceState every frame during a drag or auto-rotate.
 *
 * Theme/auto-rotate/etc. stay in localStorage only — they're personal
 * preferences, not part of the chart being shared.
 */
import type { AppState, DatasetId, SourceId, TabId } from '../stores/appState';
import type { CameraOrbit } from './scene/camera';

const VALID_TAB: TabId[] = ['globe', 'trends', 'about'];
const VALID_SRC: SourceId[] = ['oisst', 'era5', 'gfs'];
const VALID_DS: DatasetId[] = [
  'sst', 'anom', 'sst_anom', 't2m', 't2m_anom',
  't2m_mean', 't2m_max', 't2m_min',
  't2m_mean_anom', 't2m_max_anom', 't2m_min_anom',
];
const VALID_MODE = ['single', 'grid'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse URL query into a partial AppState. `date` is left to the caller to
 * apply once `availableDates` is loaded — it's returned as a sentinel field
 * named `pendingUrlDate` so the loader can resolve it post-hydration.
 */
export function readUrlState(): Partial<AppState> & {
  pendingUrlDate?: string;
  pendingUrlCamera?: CameraOrbit;
} {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const out: Partial<AppState> & {
    pendingUrlDate?: string;
    pendingUrlCamera?: CameraOrbit;
  } = {};

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

  // Unlike `date`, the loop start needs no resolution against availableDates —
  // loopStartIndex() resolves it lazily on every wrap.
  const from = p.get('from');
  if (from && DATE_RE.test(from)) out.loopStartDate = from;

  // Camera framing from a share link. Latitude stops short of the poles
  // (lookAt degenerates there) and zoom is bounded to something sane; the
  // scene clamps further against the controls' real limits when applying.
  const cam = p.get('cam');
  if (cam) {
    const parts = cam.split(',').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      out.pendingUrlCamera = {
        lat: Math.max(-89, Math.min(89, parts[0])),
        lon: parts[1],
        zoom: Math.max(0.05, Math.min(20, parts[2])),
      };
      // A framed view must hold still: the recipient's saved auto-rotate
      // setting would drift the globe away from the shared framing before
      // they even press Play. URL state wins over localStorage, so a cam
      // link turns rotation off (like any URL-applied state, it then
      // carries forward as the last-used setting).
      out.autoRotate = false;
    }
  }

  // Animation speed, in the fps terms the UI slider uses (state holds ms).
  const fps = Number(p.get('fps'));
  if (Number.isFinite(fps) && fps >= 1 && fps <= 30) {
    out.animationSpeed = Math.round(1000 / fps);
  }

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
  // The current dataset's latest date. When currentDate matches it, `date` is
  // omitted from the URL so a visitor opening the link later gets *their*
  // latest — an animation shared "through today" stays evergreen.
  latestDate?: string;
  loopStartDate?: string | null;
}

/**
 * Serialize the data slice to query params, omitting irrelevant params per
 * tab to keep URLs short:
 *   - region/mode only on Trends tab
 *   - date/from only on Globe tab (date dropped when parked on the latest)
 */
function buildParams(s: UrlStateInput): URLSearchParams {
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
    if (s.currentDate && s.currentDate !== s.latestDate) p.set('date', s.currentDate);
    if (s.loopStartDate) p.set('from', s.loopStartDate);
  }
  return p;
}

/** Replace the current URL with the serialized data slice. */
export function writeUrlState(s: UrlStateInput): void {
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}?${buildParams(s).toString()}${window.location.hash}`;
  // replaceState rather than pushState so dragging the date slider doesn't
  // create 100 back-stack entries.
  window.history.replaceState(null, '', url);
}

export interface ShareUrlInput extends UrlStateInput {
  camera?: CameraOrbit;
  fps?: number;
}

/** The deployed site, for share links embedded in artifacts that outlive the
 * current browser session (e.g. the QR code burned into exported movies —
 * a localhost origin would be dead for anyone scanning it). */
export const SITE_ORIGIN = 'https://globe-viz.oberbrunner.com';

/**
 * Absolute URL capturing the full view for sharing: everything writeUrlState
 * syncs, plus the camera framing and animation speed. A recipient sees the
 * sender's exact view and, on Play, the same animation cycle. `origin`
 * defaults to the current origin; pass SITE_ORIGIN for links that must work
 * outside this session.
 */
export function buildShareUrl(s: ShareUrlInput, origin?: string): string {
  const p = buildParams(s);
  if (s.activeTab === 'globe') {
    if (s.camera) {
      const { lat, lon, zoom } = s.camera;
      p.set('cam', `${lat.toFixed(1)},${lon.toFixed(1)},${zoom.toFixed(3)}`);
    }
    if (s.fps) p.set('fps', String(Math.round(s.fps * 10) / 10));
  }
  // Commas are legal unencoded in query values; keep the cam triple readable.
  const query = p.toString().replace(/%2C/g, ',');
  const base = origin ?? window.location.origin;
  const path = origin ? '/' : window.location.pathname;
  return `${base}${path}?${query}`;
}
