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
  dataBlob: Blob
): Promise<{ mesh: Mesh; textures: GlobeTextures }> {
  const sphereGeometry = new SphereGeometry(1, 101, 101);

  // Load data texture from blob
  const dataTextureUrl = URL.createObjectURL(dataBlob);
  const dataTexture = await textureLoader.loadAsync(dataTextureUrl);
  dataTexture.colorSpace = LinearSRGBColorSpace;
  // Store URL for cleanup later
  dataTexture.userData.objectUrl = dataTextureUrl;

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
 * Updates the globe's data texture with a new blob.
 * Properly cleans up old textures and Object URLs to prevent memory leaks.
 */
export async function updateGlobeTexture(
  mesh: Mesh,
  textureLoader: TextureLoader,
  dataBlob: Blob
): Promise<Texture> {
  const material = mesh.material as ShaderMaterial;
  const oldTexture = material.uniforms.tex.value as Texture;

  // Clean up old texture and its Object URL to prevent memory leak
  if (oldTexture && oldTexture.userData.objectUrl) {
    URL.revokeObjectURL(oldTexture.userData.objectUrl);
    oldTexture.dispose();
  }

  // Create new texture
  const dataTextureUrl = URL.createObjectURL(dataBlob);
  const newTexture = await textureLoader.loadAsync(dataTextureUrl);
  newTexture.colorSpace = LinearSRGBColorSpace;
  // Store URL for cleanup later
  newTexture.userData.objectUrl = dataTextureUrl;

  material.uniforms.tex.value = newTexture;
  material.needsUpdate = true;

  return newTexture;
}

