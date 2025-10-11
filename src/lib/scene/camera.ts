import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { isMobile, getViewportDimensions } from '../helpers/responsiveness-client';

export function createCamera(canvas: HTMLCanvasElement): PerspectiveCamera {
  const camera = new PerspectiveCamera(
    40,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );

  const viewport = getViewportDimensions();
  const aspectRatio = viewport.ratio;
  const isNarrow = aspectRatio < 1;

  if (isMobile()) {
    const distance = isNarrow ? 3.0 : 2.5;
    camera.position.set(distance, distance * 0.5, distance);
  } else {
    const distance = aspectRatio < 1.2 ? 2.5 : 2.0;
    camera.position.set(distance, distance * 0.5, distance);
  }

  return camera;
}

export function createControls(
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  target: Vector3
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  controls.target = target.clone();
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
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
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
