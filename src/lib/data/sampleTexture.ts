import type { Texture } from 'three';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// One canvas for every sample, resized to whatever image comes in. `lastImage`
// lets repeated reads of the same texture skip the redraw — sampling N datasets
// at one point costs N draws, not N per row.
let canvas: HTMLCanvasElement | undefined;
let ctx: CanvasRenderingContext2D | null = null;
let lastImage: CanvasImageSource | undefined;

/**
 * Read a single pixel out of a loaded data texture.
 *
 * Safe against canvas tainting without any extra CORS setup: `fetchDatasetAssets`
 * loads textures through `URL.createObjectURL(blob)`, which is same-origin.
 * (The bucket also sends `Access-Control-Allow-Origin: *`.)
 *
 * This costs a full-image `drawImage` per distinct texture, which is fine at
 * click time and much too slow for `pointermove` — don't wire it to hover.
 *
 * Returns null when the texture has no decoded image yet.
 */
export function samplePixel(texture: Texture, px: number, py: number): Rgba | null {
  const image = texture.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!image?.width || !image.height) return null;

  if (!canvas) {
    canvas = document.createElement('canvas');
    // Every read is a 1×1 getImageData right after a draw, so a CPU-backed
    // canvas avoids a GPU round-trip per sample.
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) return null;

  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width;
    canvas.height = image.height;
    lastImage = undefined; // resizing clears the canvas
  }
  if (lastImage !== image) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    lastImage = image;
  }

  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
  return { r, g, b, a };
}

/** Pixel dimensions of a texture's decoded image, or null if not ready. */
export function textureSize(texture: Texture): { width: number; height: number } | null {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height) return null;
  return { width: image.width, height: image.height };
}
