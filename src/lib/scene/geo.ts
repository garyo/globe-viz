import type { Vector3 } from 'three';

const RAD = 180 / Math.PI;

export interface LatLon {
  /** Degrees, -90 (south pole) .. +90 (north pole). */
  lat: number;
  /** Degrees east, 0 .. 360 — the equirect texture's convention, not ±180. */
  lon: number;
}

/**
 * Project (lat, lon) in degrees onto a sphere of radius `r`, using the same
 * convention as the globe's SphereGeometry + UV mapping so overlays align with
 * the equirectangular data texture.
 *
 * Derivation:
 *   - Texture u=0..1 maps to lon 0..360°
 *   - Texture v=0..1 maps to lat -90..+90° (matplotlib `origin="lower"`)
 *   - Three.js SphereGeometry flips V internally (UV.v = 1 - iteration.v),
 *     so the south pole lands at -Y as expected.
 */
export function latLonToSpherePoint(
  { lat, lon }: LatLon,
  r: number,
): [number, number, number] {
  const latR = lat / RAD;
  const lonR = lon / RAD;
  const cosLat = Math.cos(latR);
  return [
    -r * Math.cos(lonR) * cosLat,
    r * Math.sin(latR),
    r * Math.sin(lonR) * cosLat,
  ];
}

/**
 * Inverse of {@link latLonToSpherePoint}.
 *
 * The globe is an exact unit sphere at the origin with no transform, so world
 * coordinates go straight in. Prefer intersecting the analytic sphere over
 * raycasting the mesh: SphereGeometry is a 101×101 tessellation, and the flat
 * triangles deviate by up to ~0.5° of arc near the silhouette.
 */
export function spherePointToLatLon(p: Vector3): LatLon {
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, p.y / r))) * RAD;
  const lon = Math.atan2(p.z, -p.x) * RAD;
  return { lat, lon: ((lon % 360) + 360) % 360 };
}

/**
 * Texture pixel covering a lat/lon on an equirectangular grid (1440×720 for
 * every dataset we publish).
 *
 * Row 0 is the north pole: the pipeline writes with matplotlib
 * `origin="lower"`, which puts the highest latitude in the image's top row.
 */
export function latLonToPixel(
  { lat, lon }: LatLon,
  width: number,
  height: number,
): { px: number; py: number } {
  const px = Math.floor((lon / 360) * width);
  const py = Math.floor(((90 - lat) / 180) * height);
  return {
    px: Math.max(0, Math.min(width - 1, px)),
    py: Math.max(0, Math.min(height - 1, py)),
  };
}

/** "12.4°S, 85.2°W" — longitude shown in ±180 form, which is how people read it. */
export function formatLatLon({ lat, lon }: LatLon): string {
  const lonSigned = lon > 180 ? lon - 360 : lon;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lonSigned >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lonSigned).toFixed(1)}°${ew}`;
}
