import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Scene,
} from 'three';
import { latLonToSpherePoint, type LatLon } from './geo';

/** Just clear of the coastline overlay at 1.001, so it never z-fights. */
const MARKER_RADIUS = 1.004;

export interface PickMarker {
  moveTo(point: LatLon): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * A small ring drawn on the globe at the picked point.
 *
 * Being part of the scene rather than an HTML overlay, it follows rotation and
 * zoom for free, and depth testing hides it when the point spins to the far
 * side — which is exactly the cue that the readout refers to somewhere you
 * can't currently see.
 */
export function createPickMarker(scene: Scene): PickMarker {
  const geometry = new RingGeometry(0.012, 0.02, 24);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    // The ring is aimed at the globe's center, so its front face points inward
    // and single-sided rendering would cull it away entirely.
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);

  return {
    moveTo(point) {
      const [x, y, z] = latLonToSpherePoint(point, MARKER_RADIUS);
      mesh.position.set(x, y, z);
      // The ring is authored in the XY plane; face it along the surface normal.
      mesh.lookAt(0, 0, 0);
      mesh.visible = true;
    },
    setVisible(visible) {
      mesh.visible = visible;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
