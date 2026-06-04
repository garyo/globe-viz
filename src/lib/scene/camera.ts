import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { isMobile } from '../helpers/responsiveness-client';

const FOV = 40;
// Globe radius is 1; leave a little air around it when fitting it to view.
const FIT_MARGIN = 1.1;
// Approximate height of the header + topbar overlaying the canvas top. Only
// matters on short (phone-landscape) viewports, where the globe must fit in
// the band below them; taller viewports have plenty of slack.
const CHROME_PX = 100;
const SHORT_VIEWPORT_PX = 500;

const halfTan = () => Math.tan((FOV * Math.PI) / 360);

/**
 * Camera distance at which the whole globe (plus margin) fits the view for
 * this aspect ratio. The FOV is vertical, so on wide viewports the limiting
 * dimension is height; on narrow (portrait-phone) viewports it's width —
 * without the aspect term the globe overflows the screen edges badly.
 * For aspect ≥ 1 this lands on ~3.0, which is also the classic desktop look
 * (globe filling ~90% of the viewport height).
 */
export function fitCameraDistance(aspect: number): number {
  return FIT_MARGIN / (halfTan() * Math.min(aspect, 1));
}

/**
 * Fit distance and view-center offset for this canvas. On short viewports
 * the header/topbar overlay eats CHROME_PX of the canvas top, so the globe
 * is fit to the band below them and the view center dropped into that
 * band's middle (raising the orbit target lowers the globe on screen).
 * Elsewhere the offset is the classic +0.15 "globe sits a bit low" tilt.
 */
function viewAdjustments(canvas: HTMLCanvasElement): { dist: number; targetY: number } {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const aspect = w / h || 1;
  if (h > 0 && h < SHORT_VIEWPORT_PX) {
    const dist = (FIT_MARGIN / halfTan()) * (h / (h - CHROME_PX));
    // World units per CSS pixel at the globe, × half the chrome height.
    const targetY = (CHROME_PX / 2) * ((2 * dist * halfTan()) / h);
    return { dist, targetY };
  }
  return { dist: fitCameraDistance(aspect), targetY: 0.15 };
}

/**
 * Place the camera `distance` from the origin, facing longitude ~100°W —
 * centered on Mexico, so the eastern Pacific, the Americas, and the western
 * Atlantic are all visible at once — useful for tracking developing ENSO
 * conditions in the Niño regions alongside the western Atlantic basin.
 * The data texture maps u=0 → lon 0°, with three.js sphere UVs placing
 * u=0.25 at +Z, u=0.5 at +X, u=0.75 at -Z. So a camera direction of
 * (-cos(lon), 0, sin(lon)) (origin → camera) faces longitude `lon`.
 * The y component gives a slight downward tilt.
 */
function positionCamera(camera: PerspectiveCamera, distance: number) {
  const lonRad = (-100 * Math.PI) / 180;
  const dir = new Vector3(
    -Math.SQRT2 * Math.cos(lonRad),
    0.5,
    Math.SQRT2 * Math.sin(lonRad),
  ).normalize();
  camera.position.copy(dir.multiplyScalar(distance));
}

// Fit distance the camera was last sized for, per camera — lets the resize
// handler rescale the user's current zoom proportionally instead of
// clobbering it with a fresh fit.
const lastFit = new WeakMap<PerspectiveCamera, number>();

export function createCamera(canvas: HTMLCanvasElement): PerspectiveCamera {
  // Fall back to 1 when the canvas is hidden at mount (e.g. starting on a
  // non-Globe tab): 0/0 would seed the projection matrix with NaN, and
  // updateCameraAspect's diff check then never recovers.
  const aspect = canvas.clientWidth / canvas.clientHeight || 1;
  const camera = new PerspectiveCamera(FOV, aspect, 0.1, 100);
  const { dist } = viewAdjustments(canvas);
  positionCamera(camera, dist);
  lastFit.set(camera, dist);
  return camera;
}

export function createControls(
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  target: Vector3
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  // Raise the target above the globe center to tilt the view downward,
  // making the globe sit lower on screen (below the overlay topbar).
  const { dist, targetY } = viewAdjustments(canvas);
  const adjustedTarget = target.clone();
  adjustedTarget.y += targetY;
  controls.target = adjustedTarget;
  controls.enableDamping = true;
  controls.autoRotate = false;

  if (isMobile()) {
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.8;
    controls.dampingFactor = 0.1;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.9;
  }

  controls.minDistance = isMobile() ? 1.5 : 1.2;
  controls.maxDistance = Math.max(10, dist * 1.8);

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

/**
 * Re-fit after a viewport/orientation change: scale the camera's distance by
 * the change in fit distance, so the globe keeps the same relative size on
 * screen (and never overflows after rotating to portrait) while a deliberate
 * user zoom survives as a ratio. Idempotent — safe to call on every resize.
 */
export function refitCameraForResize(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  canvas: HTMLCanvasElement,
) {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;

  const { dist, targetY } = viewAdjustments(canvas);
  const prev = lastFit.get(camera) ?? dist;
  if (Math.abs(dist - prev) < 1e-3) return;
  lastFit.set(camera, dist);

  // Re-seat the view-center offset for the new orientation. This clobbers a
  // vertical user pan, but keeps the globe correctly framed — the better
  // trade on an orientation flip.
  controls.target.y = targetY;
  camera.position.sub(controls.target).multiplyScalar(dist / prev).add(controls.target);
  controls.maxDistance = Math.max(10, dist * 1.8);
  controls.update();
}
