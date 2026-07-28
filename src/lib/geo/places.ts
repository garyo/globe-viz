/**
 * Offline reverse lookup from a globe point to a country or water-body name.
 *
 * `public/places.json` holds two Natural Earth layers stripped down to a single
 * `name` per feature. Regenerate it with:
 *
 *   NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
 *   curl -sLO $NE/ne_110m_admin_0_countries.geojson
 *   curl -sLO $NE/ne_50m_geography_marine_polys.geojson
 *   bunx mapshaper ne_110m_admin_0_countries.geojson \
 *     -filter-fields NAME -rename-fields name=NAME -simplify 15% keep-shapes \
 *     -o precision=0.01 format=geojson countries-min.json
 *   bunx mapshaper ne_50m_geography_marine_polys.geojson \
 *     -filter-fields name,name_en,scalerank -simplify 15% keep-shapes \
 *     -o precision=0.01 format=geojson marine-min.json
 *
 * then merge the two into `{ countries: [...], marine: [...] }`, keeping only
 * `properties.name`, dropping features whose geometry simplified away to null
 * (three sliver-shaped straits do), title-casing the few all-caps ocean names,
 * and sorting marine features by descending `scalerank` so the most specific
 * water body (a gulf or sea) is matched before the ocean that contains it.
 *
 * For marine names, prefer `name_en` ("Golfo de California" → "Gulf of
 * California") — except where it drops a qualifier that `name` carries, since
 * Natural Earth's English label for "North Atlantic Ocean" is just "Atlantic
 * Ocean". Keep `name` when `name_en` is a substring of it.
 *
 * Two known limits, both fine for a coordinate readout: countries are 110m, so
 * a point within a few km of shore can land on the wrong side of the coast, and
 * ~2% of the globe (mostly around the Ross Ice Shelf) falls in a gap between
 * the simplified layers and yields no name at all.
 */

type Ring = [number, number][];

interface PlaceFeature {
  properties: { name: string };
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | string;
    coordinates: unknown;
  } | null;
}

interface PlacesData {
  countries: PlaceFeature[];
  marine: PlaceFeature[];
}

/** One entry per polygon part, with its bounding box precomputed. */
interface Part {
  name: string;
  rings: Ring[]; // [outer, ...holes]
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

interface PlaceIndex {
  countries: Part[];
  marine: Part[];
}

let loading: Promise<PlaceIndex | null> | undefined;

function bbox(ring: Ring) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

function toParts(features: PlaceFeature[]): Part[] {
  const parts: Part[] = [];
  for (const feature of features) {
    const g = feature.geometry;
    if (!g) continue;
    const polygons: Ring[][] =
      g.type === 'Polygon' ? [g.coordinates as Ring[]]
      : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][])
      : [];
    for (const rings of polygons) {
      if (!rings.length) continue;
      parts.push({ name: feature.properties.name, rings, ...bbox(rings[0]) });
    }
  }
  return parts;
}

/** Standard ray-casting test; `ring` is a closed GeoJSON linear ring. */
function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat)
        && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function findPart(parts: Part[], lon: number, lat: number): string | null {
  for (const part of parts) {
    if (lon < part.minLon || lon > part.maxLon || lat < part.minLat || lat > part.maxLat) {
      continue;
    }
    if (!inRing(part.rings[0], lon, lat)) continue;
    // Rings after the first are holes (lakes, enclaves).
    let inHole = false;
    for (let i = 1; i < part.rings.length; i++) {
      if (inRing(part.rings[i], lon, lat)) { inHole = true; break; }
    }
    if (!inHole) return part.name;
  }
  return null;
}

/**
 * Fetch and index the place polygons. Called on the first pick, then cached for
 * the page lifetime — visitors who never click the globe don't pay for it.
 * Resolves to null (rather than throwing) if the asset can't be loaded; a
 * missing place name shouldn't take the readout down with it.
 */
export function loadPlaces(): Promise<PlaceIndex | null> {
  loading ??= fetch('/places.json')
    .then((res) => {
      if (!res.ok) throw new Error(`places.json: ${res.status}`);
      return res.json() as Promise<PlacesData>;
    })
    .then((data) => ({
      countries: toParts(data.countries),
      marine: toParts(data.marine),
    }))
    .catch((err) => {
      console.warn('Failed to load place names:', err);
      return null;
    });
  return loading;
}

/**
 * Name the country or water body containing a point, or null if neither layer
 * covers it. `lon` is in the texture's 0..360 convention; GeoJSON uses ±180.
 */
export function lookupPlace(index: PlaceIndex, lat: number, lon: number): string | null {
  const lonSigned = lon > 180 ? lon - 360 : lon;
  return findPart(index.countries, lonSigned, lat)
    ?? findPart(index.marine, lonSigned, lat);
}

// ---------------------------------------------------------------------------
// Online refinement
// ---------------------------------------------------------------------------

/** Free, key-less, CORS-enabled, browser-origin only. Server use needs a key. */
const BDC_URL = 'https://api-bdc.net/data/reverse-geocode-client';
const BDC_TIMEOUT_MS = 5000;

interface BdcResponse {
  countryCode?: string;
  countryName?: string;
  principalSubdivision?: string;
  locality?: string;
}

// Keyed to ~1 km so clicking around the same spot doesn't re-query.
const refined = new Map<string, string | null>();

/**
 * Strip the ISO officialese BigDataCloud emits: "United States of America
 * (the)", "Falkland Islands (the) [Malvinas]", "Western Sahara*", and
 * Svalbard's "(Arctic Region) (see also separate country code entry under SJ)".
 */
function tidy(segment: string): string {
  return segment
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\*+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** ISO long forms that don't fit a small popup. Everything else passes through. */
const COUNTRY_SHORT_FORMS: Record<string, string> = {
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'United States of America': 'United States',
  'Russian Federation': 'Russia',
  'Iran, Islamic Republic of': 'Iran',
  'Korea, the Republic of': 'South Korea',
  "Korea, the Democratic People's Republic of": 'North Korea',
  'Tanzania, the United Republic of': 'Tanzania',
  'Venezuela, Bolivarian Republic of': 'Venezuela',
  'Bolivia, Plurinational State of': 'Bolivia',
  'Micronesia, Federated States of': 'Micronesia',
  "Lao People's Democratic Republic": 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Saint Helena, Ascension and Tristan da Cunha': 'Saint Helena',
  'British Indian Ocean Territory': 'Br. Indian Ocean Terr.',
};

function bdcName(data: BdcResponse): string | null {
  const country = data.countryName ? tidy(data.countryName) : '';
  const segments = [
    data.locality ? tidy(data.locality) : '',
    data.principalSubdivision ? tidy(data.principalSubdivision) : '',
    COUNTRY_SHORT_FORMS[country] ?? country,
  ].filter(Boolean);
  return [...new Set(segments)].join(', ') || null;
}

/**
 * Improve an offline place name using BigDataCloud's reverse geocoder, falling
 * back to the offline name whenever the service is unreachable, slow, or has
 * nothing better. The clicked coordinates are sent to that third party.
 *
 * The merge rule comes from comparing both sources across 40 varied points:
 *
 *  - A `countryCode` means BDC actually landed on territory, and it beats us
 *    decisively there. Our countries layer is 110 m, so it misses small islands
 *    entirely — Guam reads as "Philippine Sea" and Easter Island as "South
 *    Pacific Ocean" — and it resolves territories to their sovereign, calling
 *    French Guiana "France" and Hong Kong "China".
 *  - No `countryCode` means BDC fell back to maritime-zone data, which is
 *    administrative rather than geographic: the Baltic comes back as "Sweden's
 *    economic zone", the Barents Sea as "NEAFC (EEZ)", the Beaufort Sea as
 *    "Region 1, Unorganized". Our Natural Earth marine names are better, so we
 *    keep them and take BDC's only where we have no name at all.
 *
 * Note this adopts BDC's naming politics for land (it reports Somaliland as
 * Somalia, where our layer says Somaliland).
 */
export async function refinePlaceName(
  lat: number,
  lon: number,
  offline: string | null,
): Promise<string | null> {
  const lonSigned = lon > 180 ? lon - 360 : lon;
  const key = `${lat.toFixed(2)},${lonSigned.toFixed(2)}`;
  const hit = refined.get(key);
  if (hit !== undefined) return hit ?? offline;

  let best: string | null = null;
  try {
    const res = await fetch(
      `${BDC_URL}?latitude=${lat}&longitude=${lonSigned}&localityLanguage=en`,
      { signal: AbortSignal.timeout(BDC_TIMEOUT_MS) },
    );
    if (res.ok) {
      const data = (await res.json()) as BdcResponse;
      const locality = data.locality ? tidy(data.locality) : '';
      if (!data.countryCode) {
        // Water: keep our own name, taking BDC's only where we have none.
        if (!offline && locality) best = locality;
      } else if (locality && locality === offline) {
        // Territorial water whose locality is the water body itself (the
        // Hebrides, say). BDC appends the coastal state; our shorter name for
        // the same feature reads better.
        best = offline;
      } else {
        best = bdcName(data);
      }
    }
  } catch {
    // Offline, blocked, or too slow — the offline name already rendered.
  }

  refined.set(key, best);
  return best ?? offline;
}
