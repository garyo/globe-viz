/**
 * Bridge between the live Three.js scene (component-local state in
 * GlobeScene) and the movie exporter (launched from ControlPanel). Mirrors
 * the camera-orbit provider in ../scene/camera.ts. Kept free of any encoder
 * imports so it can sit in the main bundle; the heavy export machinery is
 * dynamically imported from movieExport.ts.
 */
import type { Mesh, PerspectiveCamera, Scene, TextureLoader, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { CoastlineOverlay } from '../scene/coastlines';
import type { TextureCache } from '../data/textureCache';

export interface MovieExportContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  globe: Mesh;
  coastlines: CoastlineOverlay | undefined;
  textureCache: TextureCache;
  textureLoader: TextureLoader;
  canvas: HTMLCanvasElement;
}

let provider: (() => MovieExportContext) | null = null;

export function setMovieExportProvider(fn: (() => MovieExportContext) | null) {
  provider = fn;
}

export function getMovieExportContext(): MovieExportContext | null {
  return provider?.() ?? null;
}

/** WebCodecs is required for MP4 encoding (Chrome/Edge, Safari 16.4+, Firefox 130+). */
export function isMovieExportSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window;
}
