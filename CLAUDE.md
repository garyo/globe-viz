# globe-viz

Astro + Solid.js + Three.js + ECharts SPA at https://globe-viz.oberbrunner.com — interactive 3D globe and time-series charts for climate data.

## Sister repo

`~/src/sea-surface-temp-viz` — Python pipeline that produces the S3 data we consume at `https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/`:
- `index.json` — list of available dates and time-series regions
- `YYYY-MM-DD-sst-temp-equirect.webp` + `-metadata.json` — daily textures (and `-anomaly` variants)
- `timeseries/{region}.json` — pre-aggregated time-series, parallel-array schema (`dates[]`, `values[]` per source/dataset)

The shared expansion plan lives at `/Users/garyo/.claude/plans/tranquil-imagining-seal.md` (multi-source: ERA5 + MODIS LST; regional selectors including Niño 3.4).

## Deploy

Cloudflare Pages auto-deploys on push to `main`. CNAME → `globe-viz.pages.dev`. Build settings live in the **CF dashboard, not the repo**:

- Build image: **v3**
- Build command: `bun install --frozen-lockfile && bun run build`
- Env vars: `BUN_VERSION=1.3.4`, `NODE_VERSION=24`

CF Pages does not auto-detect bun from `bun.lock` alone, and Bun is the only supported tool with no in-repo file shortcut for its version (Node has `.node-version`, Bun does not). If a deploy picks pnpm or fails on missing `astro` CLI, dashboard config is stale.

## Architecture gotchas (none of these are obvious from the code)

- **ECharts/Vite tslib interop**: `astro.config.mjs` aliases `tslib` to the top-level ESM build because `zrender` and `echarts` each ship a nested CJS `tslib` that breaks Vite's CJS-to-ESM conversion (`Cannot destructure property '__extends'`). Don't remove the alias.

- **Tabs are in-page Solid signals, not Astro routes**. This preserves the Three.js scene + texture cache + animation state across tab switches. The trade-off is that `body[data-active-tab="trends"|"about"] #scene-wrapper { display: none }` hides the WebGL canvas when off the Globe tab — the scene continues animating in the background.

- **Nested `client:only="solid-js"` islands don't compose**. Only `AppLoader` is a `client:only` island; it imports `<AppTabs />` and `<KeyboardControls />` directly. Don't refactor to `<AppLoader><AppTabs client:only/></AppLoader>` — the inner Solid `<Show>` won't hydrate sub-islands.

- **Theme system**: `data-theme="light"|"dark"` on `<html>`, set synchronously by an inline head script in `index.astro` to avoid FOUC, then reactively maintained by `applyTheme()` in `stores/appState.ts`. **All colors flow through CSS variables** — when adding components, use `var(--bg-app)` etc., not hardcoded rgba.

- **Scene background stays theme-independent**: `#scene` has a fixed white-to-gray gradient regardless of theme. The SST texture has transparent pixels at land cells (matplotlib mask), and showing them through to a theme-dependent CSS background made the land borders visibly shift between modes. Don't theme `#scene`.

- **`loadSavedState()` filters undefined values** before spreading into store defaults. When adding a new persisted appState field, add it to the `KEYS` array in `loadSavedState`, otherwise an unset value will spread `undefined` and clobber the default.

## Conventions

- `bun` for package management (per global CLAUDE.md). The lockfile is `bun.lock` (text format); do not regenerate as `bun.lockb` (binary) — bun 1.2.x on the CF Pages image can't parse it.
- TypeScript-first (per global CLAUDE.md). `bun x astro check` is the source of truth for type errors; editor diagnostics are sometimes stale.
- The 1.17MB main bundle is on the lazy-load short list — `Trends.tsx` (ECharts is the bulk) can be `lazy()`'d so it doesn't ship for Globe-only sessions.
