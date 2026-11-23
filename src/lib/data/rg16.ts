import { NearestFilter, NoColorSpace, type Texture, type TextureLoader } from 'three';

/**
 * How the pipeline packs a field into an image (sea-surface-temp-viz
 * textures.py): a 16-bit count per pixel, high byte in R and low byte in G,
 * with value = offset + scale × count and count 0 meaning "no data".
 */
export interface Rg16Encoding {
  format: 'rg16';
  scale: number;
  offset: number;
}

/** Decode one pixel; null for "no data" (land, sea ice). */
export function rg16Value(encoding: Rg16Encoding, r: number, g: number): number | null {
  const count = r * 256 + g;
  return count === 0 ? null : encoding.offset + encoding.scale * count;
}

/**
 * Load an RG16 image as a texture the shader can read counts from exactly: no
 * color-space conversion on upload, and no filtering or mipmaps (blending
 * encoded bytes would produce garbage — the shader interpolates decoded
 * values itself).
 *
 * Goes through a blob URL so the image is same-origin, letting the point
 * readout draw it to a canvas and read pixels back. The URL is kept in
 * `userData.objectUrl` for TextureCache to revoke.
 */
export async function loadRg16Texture(url: string, loader: TextureLoader): Promise<Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const objectUrl = URL.createObjectURL(await res.blob());
  const texture = await loader.loadAsync(objectUrl);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.userData.objectUrl = objectUrl;
  return texture;
}
