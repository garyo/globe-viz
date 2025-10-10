import {
  Scene,
  WebGLRenderer,
  AmbientLight,
  LoadingManager,
  ColorManagement,
  PCFSoftShadowMap,
  ACESFilmicToneMapping,
  AxesHelper,
  GridHelper,
  TextureLoader,
} from 'three';
import Stats from 'three/examples/jsm/libs/stats.module';

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  ColorManagement.enabled = true;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  return renderer;
}

export function createScene(): Scene {
  return new Scene();
}

export function createLights(scene: Scene) {
  const ambientLight = new AmbientLight('white', 0.4);
  scene.add(ambientLight);
  return { ambientLight };
}

export function createHelpers(scene: Scene) {
  const axesHelper = new AxesHelper(4);
  axesHelper.visible = false;
  scene.add(axesHelper);

  const gridHelper = new GridHelper(20, 20, 'teal', 'darkgray');
  gridHelper.position.y = -0.01;
  scene.add(gridHelper);

  return { axesHelper, gridHelper };
}

export function createLoadingManager(): LoadingManager {
  const loadingManager = new LoadingManager();
  loadingManager.onError = () => {
    console.log('❌ error while loading');
  };
  return loadingManager;
}

export function createStats(container: HTMLElement): Stats {
  const stats = new Stats();
  stats.dom.id = 'stats';
  stats.dom.style.position = 'absolute';
  stats.dom.style.top = '1px';
  stats.dom.style.left = '1px';
  container.appendChild(stats.dom);
  return stats;
}

export function createTextureLoader(): TextureLoader {
  return new TextureLoader();
}

export function resizeRendererToDisplaySize(renderer: WebGLRenderer): boolean {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}
