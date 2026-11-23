import {
  GLSL3,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector4,
} from 'three';
import type { ColormapTexture } from '../data/colormapTexture';
import type { Rg16Encoding } from '../data/rg16';
import { leapAlignedDayOfYear, yearFraction } from '../timeseriesUtils';

export interface GlobeTextures {
  dataTexture: Texture;
  earthTexture: Texture;
}

/** A baseline's per-pixel offset coefficients, as published by the pipeline. */
export interface BaselineAtlas {
  texture: Texture;
  encoding: Rg16Encoding;
  /** Rows per coefficient tile; tiles stack top-first as [a0, a1, b1, a2, b2]. */
  tileHeight: number;
}

// The data texture holds values, not colors: the shader decodes them, adds the
// selected baseline's offset, and only then applies the colormap — so one set
// of textures serves every baseline, and values stay exact for the readout.
//
// Both data and offset textures use NearestFilter and are interpolated here on
// decoded values: hardware filtering would blend encoded bytes, and would mix
// the "no data" cells (land, sea ice) into their neighbors. Interpolating only
// over cells with data, and fading the colormap out by their share of the
// weight, gives smooth coastlines without inventing values.
const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;

  uniform sampler2D earthTex;
  uniform sampler2D dataTex;
  uniform vec2 dataEncoding;      // (scale, offset): value = offset + scale × count
  uniform sampler2D cmapTex;
  uniform vec2 cmapRange;         // (vmin, vmax)
  uniform bool baselineOn;
  uniform sampler2D baselineTex;
  uniform vec2 baselineEncoding;
  uniform int baselineTileHeight;
  uniform vec4 season;            // cos 2πτ, sin 2πτ, cos 4πτ, sin 4πτ

  in vec2 vUv;
  out vec4 fragColor;

  float countAt(sampler2D tex, ivec2 p) {
    vec2 rg = floor(texelFetch(tex, p, 0).rg * 255.0 + 0.5);
    return rg.r * 256.0 + rg.g;
  }

  // Bilinear footprint of uv on a width × rows grid of texel centers:
  // the lower-left texel and the fractional position past it.
  void footprint(vec2 uv, int width, int rows, out ivec2 base, out vec2 f) {
    vec2 p = uv * vec2(width, rows) - 0.5;
    base = ivec2(floor(p));
    f = p - floor(p);
  }

  ivec2 cell(ivec2 base, int dx, int dy, int width, int rows) {
    return ivec2((base.x + dx + width) % width, clamp(base.y + dy, 0, rows - 1));
  }

  float weight(vec2 f, int dx, int dy) {
    return (dx == 0 ? 1.0 - f.x : f.x) * (dy == 0 ? 1.0 - f.y : f.y);
  }

  // (value, coverage): the mean over neighboring cells that have data, and
  // the bilinear weight those cells carry (0 over land, 1 in open water).
  vec2 sampleData(vec2 uv) {
    ivec2 size = textureSize(dataTex, 0);
    ivec2 base;
    vec2 f;
    footprint(uv, size.x, size.y, base, f);
    float sum = 0.0;
    float covered = 0.0;
    for (int dy = 0; dy < 2; dy++) {
      for (int dx = 0; dx < 2; dx++) {
        float count = countAt(dataTex, cell(base, dx, dy, size.x, size.y));
        if (count > 0.5) {
          float w = weight(f, dx, dy);
          sum += w * (dataEncoding.y + dataEncoding.x * count);
          covered += w;
        }
      }
    }
    return vec2(covered > 0.0 ? sum / covered : 0.0, covered);
  }

  // Coefficient k of the baseline offset at uv; tile k sits k tiles from the
  // top of the image, i.e. (4 − k) tiles up from texel row 0.
  float baselineTerm(int k, vec2 uv) {
    int width = textureSize(baselineTex, 0).x;
    int rows = baselineTileHeight;
    ivec2 base;
    vec2 f;
    footprint(uv, width, rows, base, f);
    int rowOffset = (4 - k) * rows;
    float sum = 0.0;
    for (int dy = 0; dy < 2; dy++) {
      for (int dx = 0; dx < 2; dx++) {
        ivec2 c = cell(base, dx, dy, width, rows);
        float count = countAt(baselineTex, ivec2(c.x, c.y + rowOffset));
        sum += weight(f, dx, dy) * (baselineEncoding.y + baselineEncoding.x * count);
      }
    }
    return sum;
  }

  float baselineOffset(vec2 uv) {
    return baselineTerm(0, uv)
      + baselineTerm(1, uv) * season.x + baselineTerm(2, uv) * season.y
      + baselineTerm(3, uv) * season.z + baselineTerm(4, uv) * season.w;
  }

  void main() {
    vec2 data = sampleData(vUv);
    float value = data.x + (baselineOn ? baselineOffset(vUv) : 0.0);
    float t = clamp((value - cmapRange.x) / (cmapRange.y - cmapRange.x), 0.0, 1.0);
    // Index texel centers so both ends of the colormap are reached exactly.
    float lutSize = float(textureSize(cmapTex, 0).x);
    vec3 color = texture(cmapTex, vec2((t * (lutSize - 1.0) + 0.5) / lutSize, 0.5)).rgb;
    // The earth map's longitude origin is half a turn from the data's.
    vec4 earth = texture(earthTex, vec2(vUv.x + 0.5, vUv.y));
    fragColor = mix(earth, vec4(color, 1.0), data.y);
  }
`;

const vertexShader = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export async function createGlobe(
  textureLoader: TextureLoader,
  dataTexture: Texture
): Promise<{ mesh: Mesh; textures: GlobeTextures }> {
  const sphereGeometry = new SphereGeometry(1, 101, 101);

  const earthTexture = await textureLoader
    .loadAsync('/8k_earth_daymap.jpg')
    .catch((error) => {
      console.error(`Failed to load earth map texture: ${error}`);
      return new Texture();
    });
  earthTexture.wrapS = RepeatWrapping;
  earthTexture.wrapT = RepeatWrapping;

  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      earthTex: { value: earthTexture },
      dataTex: { value: null },
      dataEncoding: { value: [0, 0] },
      cmapTex: { value: null },
      cmapRange: { value: [0, 1] },
      baselineOn: { value: false },
      baselineTex: { value: null },
      baselineEncoding: { value: [0, 0] },
      baselineTileHeight: { value: 1 },
      season: { value: new Vector4() },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
  });

  const mesh = new Mesh(sphereGeometry, material);
  mesh.castShadow = true;
  updateGlobeTexture(mesh, dataTexture);

  return {
    mesh,
    textures: {
      dataTexture,
      earthTexture,
    },
  };
}

/**
 * Show a data texture (as loaded by fetchDatasetAssets) on the globe. Its
 * encoding, colormap, and date — which places the baseline offset in its
 * seasonal cycle — all come from the texture's userData.
 * Does NOT dispose the old texture, which may still be in the cache.
 */
export function updateGlobeTexture(mesh: Mesh, texture: Texture): void {
  const { uniforms } = mesh.material as ShaderMaterial;
  const encoding = texture.userData.encoding as Rg16Encoding | undefined;
  const colormap = texture.userData.colormap as ColormapTexture | undefined;
  const date = texture.userData.date as string | undefined;

  uniforms.dataTex.value = texture;
  if (encoding) uniforms.dataEncoding.value = [encoding.scale, encoding.offset];
  if (colormap) {
    uniforms.cmapTex.value = colormap.texture;
    uniforms.cmapRange.value = [colormap.vmin, colormap.vmax];
  }
  if (date) {
    const angle = 2 * Math.PI * yearFraction(leapAlignedDayOfYear(date));
    (uniforms.season.value as Vector4).set(
      Math.cos(angle), Math.sin(angle), Math.cos(2 * angle), Math.sin(2 * angle),
    );
  }
}

/** Add a baseline's offset to every pixel, or pass null for the reference. */
export function setGlobeBaseline(mesh: Mesh, atlas: BaselineAtlas | null): void {
  const { uniforms } = mesh.material as ShaderMaterial;
  uniforms.baselineOn.value = atlas !== null;
  if (!atlas) return;
  uniforms.baselineTex.value = atlas.texture;
  uniforms.baselineEncoding.value = [atlas.encoding.scale, atlas.encoding.offset];
  uniforms.baselineTileHeight.value = atlas.tileHeight;
}
