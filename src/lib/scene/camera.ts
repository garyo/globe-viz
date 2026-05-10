import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { isMobile, getViewportDimensions } from '../helpers/responsiveness-client';

export function createCamera(canvas: HTMLCanvasElement): PerspectiveCamera {
  // Fall back to 1 when the canvas is hidden at mount (e.g. starting on a
  // non-Globe tab): 0/0 would seed the projection matrix with NaN, and
  // updateCameraAspect's diff check then never recovers.
  const aspect = canvas.clientWidth / canvas.clientHeight || 1;
  const camera = new PerspectiveCamera(40, aspect, 0.1, 100);

  const viewport = getViewportDimensions();
  const aspectRatio = viewport.ratio;
  const isNarrow = aspectRatio < 1;

  const distance = isMobile()
    ? (isNarrow ? 3.0 : 2.5)
    : (aspectRatio < 1.2 ? 2.5 : 2.0);

  // Center the initial view on Mexico (~100°W), so the eastern Pacific,
  // the Americas, and the western Atlantic are all visible at once —
  // useful for tracking developing ENSO conditions in the Niño regions
  // alongside the western Atlantic basin.
  // The data texture maps u=0 → lon 0°, with three.js sphere UVs placing
  // u=0.25 at +Z, u=0.5 at +X, u=0.75 at -Z. So a camera direction of
  // (-cos(lon), 0, sin(lon)) (origin → camera) faces longitude `lon`.
  const lonRad = -100 * Math.PI / 180;
  const horiz = distance * Math.SQRT2;
  camera.position.set(
    -horiz * Math.cos(lonRad),
    distance * 0.5,
    horiz * Math.sin(lonRad),
  );

  return camera;
}

export function createControls(
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  target: Vector3
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  // Set target slightly above center to tilt view downward
  // This makes the globe sit lower on screen (useful with overlay topbar)
  const adjustedTarget = target.clone();
  adjustedTarget.y += 0.15;
  controls.target = adjustedTarget;
  controls.enableDamping = true;
  controls.autoRotate = false;

  const viewport = getViewportDimensions();
  const aspectRatio = viewport.ratio;

  if (isMobile()) {
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.8;
    controls.dampingFactor = 0.1;

    const minDist = aspectRatio < 1 ? 2.0 : 1.5;
    const maxDist = aspectRatio < 1 ? 10 : 8;
    controls.minDistance = minDist;
    controls.maxDistance = maxDist;

    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.9;
  } else {
    const minDist = aspectRatio < 1.2 ? 1.5 : 1.2;
    const maxDist = aspectRatio < 1.2 ? 12 : 10;
    controls.minDistance = minDist;
    controls.maxDistance = maxDist;
  }

  controls.update();

  return controls;
}

export function updateCameraAspect(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  const newAspect = w / h;
  if (Math.abs(camera.aspect - newAspect) > 0.001) {
    camera.aspect = newAspect;
    camera.updateProjectionMatrix();
  }
}

export function updateControlsForResize(controls: OrbitControls) {
  const viewport = getViewportDimensions();
  const aspectRatio = viewport.ratio;

  if (isMobile()) {
    const minDist = aspectRatio < 1 ? 2.0 : 1.5;
    const maxDist = aspectRatio < 1 ? 10 : 8;
    controls.minDistance = minDist;
    controls.maxDistance = maxDist;
  } else {
    const minDist = aspectRatio < 1.2 ? 1.5 : 1.2;
    const maxDist = aspectRatio < 1.2 ? 12 : 10;
    controls.minDistance = minDist;
    controls.maxDistance = maxDist;
  }
}
