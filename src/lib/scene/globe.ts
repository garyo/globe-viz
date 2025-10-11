import {
  SphereGeometry,
  Mesh,
  ShaderMaterial,
  Texture,
  TextureLoader,
  LinearSRGBColorSpace,
  RepeatWrapping,
} from 'three';

export interface GlobeTextures {
  dataTexture: Texture;
  earthTexture: Texture;
}

export async function createGlobe(
  textureLoader: TextureLoader,
  dataTexture: Texture
): Promise<{ mesh: Mesh; textures: GlobeTextures }> {
  const sphereGeometry = new SphereGeometry(1, 101, 101);

  // Data texture is already loaded and configured
  // Just ensure color space is set
  dataTexture.colorSpace = LinearSRGBColorSpace;

  // Load earth base texture
  const earthTexture = await textureLoader
    .loadAsync('/8k_earth_daymap.jpg')
    .catch((error) => {
      console.error(`Failed to load earth map texture: ${error}`);
      return new Texture();
    });
  earthTexture.wrapS = RepeatWrapping;
  earthTexture.wrapT = RepeatWrapping;

  // Create shader material that blends the data texture with earth texture
  const material = new ShaderMaterial({
    uniforms: {
      tex: { value: dataTexture },
      earthTex: { value: earthTexture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tex;
      uniform sampler2D earthTex;
      varying vec2 vUv;
      void main() {
        vec4 texColor = texture2D(tex, vUv);
        vec2 mapUv;
        mapUv.y = vUv.y;
        mapUv.x = vUv.x + 0.5; // offset to match longitude of main texture
        vec4 earthTexColor = texture2D(earthTex, mapUv);
        float alpha = texColor.a;
        gl_FragColor = mix(earthTexColor, texColor, alpha);
      }
    `,
    transparent: true,
  });

  const mesh = new Mesh(sphereGeometry, material);
  mesh.castShadow = true;

  return {
    mesh,
    textures: {
      dataTexture,
      earthTexture,
    },
  };
}

/**
 * Updates the globe's data texture with a pre-decoded texture.
 * Note: Does NOT dispose old texture as it may still be in cache.
 */
export function updateGlobeTexture(
  mesh: Mesh,
  newTexture: Texture
): void {
  const material = mesh.material as ShaderMaterial;

  // Ensure color space is set
  newTexture.colorSpace = LinearSRGBColorSpace;

  // Simply swap the texture - no async decode needed!
  material.uniforms.tex.value = newTexture;
  material.needsUpdate = true;
}

