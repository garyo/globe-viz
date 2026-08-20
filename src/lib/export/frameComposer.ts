/**
 * Renders export frames: a dedicated offscreen WebGLRenderer draws the live
 * Scene at the fixed output size (so the on-screen view is never resized or
 * distorted), and each frame is composited onto a 2D canvas with the app's
 * scene-background gradient plus the burned-in info band. The encoder
 * captures from the composite canvas.
 */
import { ACESFilmicToneMapping, ColorManagement, WebGLRenderer, type Texture } from 'three';
import type { MovieExportContext } from './exportContext';
import { createExportCamera } from '../scene/camera';
import { updateGlobeTexture } from '../scene/globe';
import { drawOverlay, OVERLAY_BAND_PX, type OverlaySpec } from './overlay';

export interface FrameComposer {
  /** The composite canvas the encoder captures from. */
  canvas: HTMLCanvasElement;
  /** Swap in this date's texture, render, and composite one frame.
   * `progress` is the frame's position within the cycle, 0..1. */
  renderFrame(texture: Texture, currentDate: string, progress: number): void;
  dispose(): void;
}

export function createFrameComposer(
  ctx: MovieExportContext,
  width: number,
  height: number,
  overlay: OverlaySpec,
): FrameComposer {
  // Offscreen renderer configured like the live one (setup.ts createRenderer),
  // but at a fixed size with pixelRatio 1.
  ColorManagement.enabled = true;
  const glCanvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setSize(width, height, false);

  const bandPx = Math.round((OVERLAY_BAND_PX * height) / 1080);
  const camera = createExportCamera(ctx.camera, ctx.controls.target, width, height, bandPx);

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const g = composite.getContext('2d');
  if (!g) throw new Error('Could not create 2D canvas context');

  // The app's #scene background: fixed white-to-gray gradient, deliberately
  // theme-independent (see global.css / CLAUDE.md) — land pixels in the data
  // texture are transparent and show this through.
  const background = g.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, 'rgb(100, 100, 100)');
  background.addColorStop(1, 'rgb(255, 255, 255)');

  const renderFrame = (texture: Texture, currentDate: string, progress: number) => {
    renderer.initTexture(texture);
    updateGlobeTexture(ctx.globe, texture);

    // The coastline line width is a screen-space uniform shared with the live
    // renderer — point it at the export resolution just for this render.
    ctx.coastlines?.setResolution(width, height);
    renderer.render(ctx.scene, camera);
    ctx.coastlines?.setResolution(ctx.canvas.width, ctx.canvas.height);

    // Composite synchronously in this same task: the renderer runs without
    // preserveDrawingBuffer, so the GL canvas is only readable before the
    // browser's next compositing step.
    g.fillStyle = background;
    g.fillRect(0, 0, width, height);
    g.drawImage(glCanvas, 0, 0);
    drawOverlay(g, width, height, overlay, currentDate, progress);
  };

  return {
    canvas: composite,
    renderFrame,
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
