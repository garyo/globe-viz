import { Vector2 } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

const DEG = Math.PI / 180;

/**
 * Project (lat, lon) in degrees onto a sphere using the same convention as
 * the globe's SphereGeometry + UV mapping, so coastline overlays align with
 * the equirectangular data texture.
 *
 * Derivation:
 *   - Texture u=0..1 maps to lon 0..360°
 *   - Texture v=0..1 maps to lat -90..+90° (matplotlib `origin="lower"`)
 *   - Three.js SphereGeometry flips V internally (UV.v = 1 - iteration.v),
 *     so the south pole lands at -Y as expected.
 *
 *   x = -r * cos(lon_rad) * cos(lat_rad)
 *   y =  r * sin(lat_rad)
 *   z =  r * sin(lon_rad) * cos(lat_rad)
 */
function pushSpherePoint(
  positions: number[],
  lat: number,
  lon: number,
  r: number,
): void {
  const latR = lat * DEG;
  const lonR = lon * DEG;
  const cosLat = Math.cos(latR);
  positions.push(
    -r * Math.cos(lonR) * cosLat,
    r * Math.sin(latR),
    r * Math.sin(lonR) * cosLat,
  );
}

interface GeoJSONFeature {
  geometry: {
    type: 'LineString' | 'MultiLineString' | string;
    coordinates: unknown;
  };
}

interface GeoJSONFeatureCollection {
  features: GeoJSONFeature[];
}

export interface CoastlineOverlay {
  line: LineSegments2;
  material: LineMaterial;
  /** Call on window resize so screen-space line width stays consistent. */
  setResolution(width: number, height: number): void;
  /** Three.js disposables — call on scene cleanup. */
  dispose(): void;
}

export interface CoastlineOptions {
  /** Sphere radius. Use slightly > 1 to avoid z-fighting with the globe. */
  radius: number;
  /** CSS-ish color. Use a hex like 0xRRGGBB. */
  color: number;
  /** Screen-space line width in pixels. */
  linewidth?: number;
  /** 0..1, lower = more subtle. */
  opacity?: number;
}

/**
 * Fetch a coastline GeoJSON and build a Three.js Line2 overlay sitting just
 * above the globe's surface. Line2 (fat lines) is anti-aliased and screen-
 * space, so the outline stays crisp at any zoom level.
 */
export async function loadCoastlines(
  url: string,
  options: CoastlineOptions,
): Promise<CoastlineOverlay> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load coastlines ${url}: ${res.status}`);
  }
  const data = (await res.json()) as GeoJSONFeatureCollection;

  // Flatten every LineString / MultiLineString into one big LineSegments
  // position buffer (pairs of points, each pair is one segment). One mesh,
  // one draw call, regardless of how many distinct islands/continents.
  const positions: number[] = [];
  for (const feature of data.features) {
    const g = feature.geometry;
    let lines: [number, number][][] = [];
    if (g.type === 'LineString') {
      lines = [g.coordinates as [number, number][]];
    } else if (g.type === 'MultiLineString') {
      lines = g.coordinates as [number, number][][];
    } else {
      continue;
    }
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [lon0, lat0] = line[i];
        const [lon1, lat1] = line[i + 1];
        pushSpherePoint(positions, lat0, lon0, options.radius);
        pushSpherePoint(positions, lat1, lon1, options.radius);
      }
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color: options.color,
    linewidth: options.linewidth ?? 1.0,
    transparent: true,
    opacity: options.opacity ?? 0.5,
    worldUnits: false,
    depthTest: true,
    resolution: new Vector2(
      typeof window !== 'undefined' ? window.innerWidth : 1,
      typeof window !== 'undefined' ? window.innerHeight : 1,
    ),
  });

  const line = new LineSegments2(geometry, material);
  // computeLineDistances is required for dashed lines; safe to call for solid.
  line.computeLineDistances();

  return {
    line,
    material,
    setResolution(width, height) {
      material.resolution.set(width, height);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
