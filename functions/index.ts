/**
 * Social-media previews that match the view a link opens.
 *
 * Crawlers don't run the SPA, so the only thing they see is this page's static
 * <meta> tags. For each request to `/`, point og:image (and the title,
 * description and alt text that go with it) at the card the data pipeline
 * pre-rendered for the link's `src`/`ds`/`region`, e.g.
 * `?tab=trends&src=oisst&ds=anom&region=nino_3_4` → `oisst-anom-nino_3_4.jpg`.
 * The cards and their text are listed in `og/manifest.json`, which
 * sea-surface-temp-viz/export_og_cards.py rewrites nightly.
 *
 * Anything that goes wrong (manifest unreachable or slow, unknown card) falls
 * back to the static tags in index.astro, so the page itself never breaks.
 */

interface Card {
  date: string;
  title: string;
  description: string;
  alt: string;
}

interface Manifest {
  cards: Record<string, Card>;
}

interface Env {
  // Overrides the card location, for testing against a local copy.
  OG_BASE?: string;
}

const OG_BASE = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/og/';
// The app's default view (globe, OISST anomaly), which a bare link opens.
const DEFAULT_CARD = 'oisst-anom-global';
const MANIFEST_TIMEOUT_MS = 1500;

/** Candidate card keys for a URL, most specific first. */
function cardKeys(params: URLSearchParams): string[] {
  const src = params.get('src');
  const ds = params.get('ds');
  if (!src || !ds) return [DEFAULT_CARD];
  const region = params.get('region') ?? 'global';
  return [`${src}-${ds}-${region}`, `${src}-${ds}-global`, DEFAULT_CARD];
}

async function fetchManifest(base: string): Promise<Manifest | null> {
  try {
    const res = await fetch(`${base}manifest.json`, {
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    return res.ok ? await res.json<Manifest>() : null;
  } catch {
    return null;
  }
}

function setContent(value: string): HTMLRewriterElementContentHandlers {
  return { element: (el) => void el.setAttribute('content', value) };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, next }) => {
  const base = env.OG_BASE ?? OG_BASE;
  const [page, manifest] = await Promise.all([next(), fetchManifest(base)]);
  if (!manifest || !page.headers.get('content-type')?.includes('text/html')) return page;

  const url = new URL(request.url);
  const key = cardKeys(url.searchParams).find((k) => k in manifest.cards);
  if (!key) return page;
  const card = manifest.cards[key];
  url.hash = '';

  return new HTMLRewriter()
    .on('meta[property="og:url"]', setContent(url.href))
    .on('meta[property="og:image"], meta[name="twitter:image"]',
      setContent(`${base}${key}.jpg?v=${card.date}`))
    .on('meta[property="og:title"], meta[name="twitter:title"]', setContent(card.title))
    .on('meta[property="og:description"], meta[name="twitter:description"]',
      setContent(card.description))
    .on('meta[property="og:image:alt"], meta[name="twitter:image:alt"]', setContent(card.alt))
    .transform(page);
};
