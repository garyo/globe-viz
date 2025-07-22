import GUI from 'lil-gui'
import {
  AmbientLight,
  AxesHelper,
  SphereGeometry,
  Clock,
  ColorManagement,
  GridHelper,
  LoadingManager,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Texture,
  TextureLoader,
  WebGLRenderer,
  ACESFilmicToneMapping,
  ShaderMaterial,
  Color,
  LinearSRGBColorSpace,
  RepeatWrapping,
} from 'three'
import * as d3 from 'd3'
import { legendColor } from 'd3-svg-legend'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import Stats from 'three/examples/jsm/libs/stats.module'
import * as animations from './helpers/animations'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize, isMobile, getViewportDimensions, createResizeHandler } from './helpers/responsiveness'
import './style.css'

const CANVAS_ID = 'scene'

let canvas: HTMLElement
let renderer: WebGLRenderer
let scene: Scene
let loadingManager: LoadingManager
let ambientLight: AmbientLight
let pointLight: PointLight
let sphere: Mesh
let texture: Texture
let earthTexture: Texture
let textureLoader: TextureLoader
let camera: PerspectiveCamera
let cameraControls: OrbitControls
let axesHelper: AxesHelper
let clock: Clock
let stats: Stats
let gui: GUI
let mobileMenuButton: HTMLButtonElement | null = null

const animation = { enabled: false, play: true, speed: Math.PI / 10.0 }
const props = {
  landColor: new Color(0xaaaaaa),
  dataset: 'Temp Anomaly',
  showStats: false,
}

export interface Metadata {
  cmap: [number, string][]
  title: string
  dataset: string
  date: string
  year: number
  month: number
  day: number
}

let assets: {sstTexture: Blob|null, sstMetadata: Metadata,
  sstAnomalyTexture: Blob|null, sstAnomalyMetadata: Metadata} = {
    sstTexture: null,
    sstMetadata: {cmap:[], title:"", dataset:"", date:"", year: 0, month: 0, day: 0},
    sstAnomalyTexture: null,
    sstAnomalyMetadata: {cmap:[], title:"", dataset:"", date:"", year: 0, month: 0, day: 0}}

assets = await getAssets()
await init()
animate()

async function getAssets() {
  if (!assets.sstTexture) {
    const bucketUrl = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/'
    const sstTextureUrl = bucketUrl + 'sst-temp-equirect.png'
    const sstMetadataUrl = bucketUrl + 'sst-temp-equirect-metadata.json'
    const sstAnomalyTextureUrl = bucketUrl + 'sst-temp-anomaly-equirect.png'
    const sstAnomalyMetadataUrl = bucketUrl + 'sst-temp-anomaly-equirect-metadata.json'

    const [sstTextureResult, sstMetadataResult, sstAnomalyTextureResult, sstAnomalyMetadataResult] =
      await Promise.all([
        fetch(sstTextureUrl),
        fetch(sstMetadataUrl),
        fetch(sstAnomalyTextureUrl),
        fetch(sstAnomalyMetadataUrl)
      ]);
      
    assets = {
      sstTexture: await sstTextureResult.blob(),
      sstMetadata: await sstMetadataResult.json(),
      sstAnomalyTexture: await sstAnomalyTextureResult.blob(),
      sstAnomalyMetadata: await sstAnomalyMetadataResult.json(),
    }
  }
  return assets
}

async function loadTexture(datasetName: String) {
  const data = await getAssets()
  let textureUrl: string
  
  if (datasetName == 'Temperature') {
    textureUrl = URL.createObjectURL(data.sstTexture as Blob)
  } else if (datasetName == 'Temp Anomaly') {
    textureUrl = URL.createObjectURL(data.sstAnomalyTexture as Blob)
  } else {
    textureUrl = `no-url-for-dataset-${datasetName}`
  }

  try {
    texture = await textureLoader.loadAsync(textureUrl)
    texture.needsUpdate = true
    saveTextureToLocalStorage(texture)
  } catch (err) {
    try {
      texture = await getLastTextureFromLocalStorage()
    } catch (fallbackErr) {
      console.error(`Unable to load texture: ${err}`)
    }
  }

  earthTexture = await textureLoader.loadAsync('/8k_earth_daymap.jpg')
    .catch((error) => {
      console.error(`Failed to load earth map texture: ${error}`)
      return new Texture()
    })
  earthTexture.wrapS = RepeatWrapping
  earthTexture.wrapT = RepeatWrapping

  if (sphere) {
    const material = sphere.material as ShaderMaterial
    material.uniforms.tex.value = texture
    material.uniforms.earthTex.value = earthTexture
  }
}

async function setupColormap(datasetName: String) {
  const data = await getAssets()
  let domains, ranges, cells, title, format
  
  if (datasetName == 'Temperature') {
    domains = data.sstMetadata.cmap.map(x=>x[0]);
    ranges = data.sstMetadata.cmap.map(x=>x[1]);
    cells = [0, 10, 20, 22, 23, 24, 25, 30, 32, 33, 35]
    title = 'Temperature, °C'
    format = '.0f'
  }
  else {
    domains = data.sstAnomalyMetadata.cmap.map(x=>x[0]);
    ranges = data.sstAnomalyMetadata.cmap.map(x=>x[1]);
    cells = domains
    title = 'Temperature Anomaly, °C'
    format = '.1f'
  }
  
  const linear = d3.scaleLinear(domains, ranges)
  const svg = d3.select("#colormap");
  svg.selectAll("*").remove();

  const mobile = isMobile();
  const shapeWidth = mobile ? 20 : 30;
  const translateX = mobile ? 5 : 10;
  const translateY = mobile ? 12 : 20;

  svg.append("g")
    .attr("class", "legendLinear")
    .attr("transform", `translate(${translateX}, ${translateY})`);

  const legendLinear = legendColor()
    .shapeWidth(shapeWidth)
    .cells(cells)
    .labelFormat(d3.format(format))
    .orient('horizontal')
    .title(title)
    .scale(linear);

  svg.select(".legendLinear")
    .call(legendLinear as any);
}

async function saveTextureToLocalStorage(texture: Texture) {
  localStorage.setItem('sst-texture', JSON.stringify(texture.source.toJSON()))
}

async function getLastTextureFromLocalStorage() {
  let data = localStorage.getItem('sst-texture')
  if (!data)
    throw new Error("Can't get texture from local storage")
  const jsonData = JSON.parse(data)
  const texture = await textureLoader.loadAsync(jsonData.url)
  return texture
}

async function init() {
  // ===== 🖼️ CANVAS, RENDERER, & SCENE =====
  {
    ColorManagement.enabled = true
    canvas = document.querySelector(`canvas#${CANVAS_ID}`)!
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    renderer.toneMapping = ACESFilmicToneMapping
    scene = new Scene()
  }

  // ===== 👨🏻‍💼 LOADING MANAGER =====
  {
    loadingManager = new LoadingManager()
    loadingManager.onError = () => {
      console.log('❌ error while loading')
    }
  }

  // ===== 💡 LIGHTS =====
  {
    ambientLight = new AmbientLight('white', 0.4)
    scene.add(ambientLight)

    const usePointLight = false
    if (usePointLight) {
      pointLight = new PointLight('white', 20, 100)
      pointLight.position.set(-2, 2, 2)
      pointLight.castShadow = true
      pointLight.shadow.radius = 4
      pointLight.shadow.camera.near = 0.5
      pointLight.shadow.camera.far = 4000
      pointLight.shadow.mapSize.width = 2048
      pointLight.shadow.mapSize.height = 2048
      scene.add(pointLight)
    }
  }

  // ===== 📦 OBJECTS =====
  {
    const sphereGeometry = new SphereGeometry(1, 101, 101)
    textureLoader = new TextureLoader();
    await loadTexture(props.dataset)
    texture.colorSpace = LinearSRGBColorSpace

    await setupColormap(props.dataset)

    // A material that blends the transparent texture with a fixed color
    const textureMaterial = new ShaderMaterial({
        uniforms: {
            tex: { value: texture },
            earthTex: { value: earthTexture },
            color: { value: props.landColor }
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
            uniform vec3 color;
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
        transparent: true
    });

    sphere = new Mesh(sphereGeometry, textureMaterial)
    sphere.castShadow = true
    scene.add(sphere)

    const usePlane = false
    if (usePlane) {
      const planeGeometry = new PlaneGeometry(3, 3)
      const planeMaterial = new MeshLambertMaterial({
        color: 'gray',
        emissive: 'teal',
        emissiveIntensity: 0.2,
        side: 2,
        transparent: true,
        opacity: 0.4,
      })
      const plane = new Mesh(planeGeometry, planeMaterial)
      plane.rotateX(Math.PI / 2)
      plane.receiveShadow = true
      scene.add(plane)
    }
  }

  // ===== 🎥 CAMERA =====
  {
    camera = new PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100)
    
    const viewport = getViewportDimensions();
    const aspectRatio = viewport.ratio;
    const isNarrow = aspectRatio < 1;
    
    if (isMobile()) {
      const distance = isNarrow ? 3.0 : 2.5;
      camera.position.set(distance, distance * 0.5, distance)
    } else {
      const distance = aspectRatio < 1.2 ? 2.5 : 2.0;
      camera.position.set(distance, distance * 0.5, distance)
    }
  }

  // ===== 🕹️ CONTROLS =====
  {
    cameraControls = new OrbitControls(camera, canvas)
    cameraControls.target = sphere.position.clone()
    cameraControls.enableDamping = true
    cameraControls.autoRotate = false
    
    const viewport = getViewportDimensions();
    const aspectRatio = viewport.ratio;
    
    if (isMobile()) {
      cameraControls.rotateSpeed = 0.8
      cameraControls.zoomSpeed = 0.8
      cameraControls.panSpeed = 0.8
      cameraControls.dampingFactor = 0.1
      
      const minDist = aspectRatio < 1 ? 2.0 : 1.5;
      const maxDist = aspectRatio < 1 ? 10 : 8;
      cameraControls.minDistance = minDist
      cameraControls.maxDistance = maxDist
      
      cameraControls.minPolarAngle = Math.PI * 0.1
      cameraControls.maxPolarAngle = Math.PI * 0.9
    } else {
      const minDist = aspectRatio < 1.2 ? 1.5 : 1.2;
      const maxDist = aspectRatio < 1.2 ? 12 : 10;
      cameraControls.minDistance = minDist
      cameraControls.maxDistance = maxDist
    }
    
    cameraControls.update()

    // Full screen on double-click or double-tap
    let lastTouchTime = 0
    
    window.addEventListener('dblclick', (event) => {
      if (event.target === canvas) {
        toggleFullScreen(canvas)
      }
    })
    
    canvas.addEventListener('touchend', (event) => {
      const currentTime = new Date().getTime()
      const tapLength = currentTime - lastTouchTime
      if (tapLength < 500 && tapLength > 0) {
        event.preventDefault()
        toggleFullScreen(canvas)
      }
      lastTouchTime = currentTime
    })
  }

  // ===== 🪄 HELPERS =====
  {
    axesHelper = new AxesHelper(4)
    axesHelper.visible = false
    scene.add(axesHelper)

    const gridHelper = new GridHelper(20, 20, 'teal', 'darkgray')
    gridHelper.position.y = -0.01
    scene.add(gridHelper)
  }

  // ===== 📈 STATS & CLOCK =====
  {
    clock = new Clock()
    stats = new Stats()
    stats.dom.id = 'stats'
    stats.dom.style.position = 'absolute'
    stats.dom.style.top = '1px';
    stats.dom.style.left = '1px';
    const top = document.getElementById('scene-wrapper')
    top!.appendChild(stats.dom)
    if (!props.showStats)
      stats.dom.hidden = true
  }

  // ==== MAIN GUI ====
  {
    const container = document.getElementById('scene-wrapper')
    const guiWidth = isMobile() ? Math.min(280, window.innerWidth - 40) : 300
    
    gui = new GUI({ 
      title: 'Options', 
      width: guiWidth, 
      container: container!,
      closeFolders: isMobile()
    })
    gui.domElement.id = 'gui'

    const saveName = 'mainUiState'
    const animateGlobe = false  // if false, animate using camera

    gui.add(props, 'dataset', ['Temperature', 'Temp Anomaly'])
      .name('Dataset')
      .onChange(async (val: String) => {
        await Promise.all([setupColormap(val), loadTexture(val)]);
        if (isMobile()) {
          toggleMobileMenu(false);
        }
      })
      
    if (animateGlobe) {
      gui.add(animation, 'enabled').name('Auto Rotate')
      gui.add(animation, 'speed', 0, Math.PI / 4, Math.PI / 400).name('Auto Rotate Speed')
    } else {
      gui.add(cameraControls, 'autoRotate').name('Auto Rotate')
      gui.add(cameraControls, 'autoRotateSpeed', 0, 5, 0.1).name('Auto Rotate Speed')
    }
    
    gui.addColor(props, 'landColor').name('Land Color')

    // Debug controls
    const debugUI = gui.addFolder('🐞 Details/Debug')
    debugUI.add(props, 'showStats')
      .name("Show FPS Stats")
      .onChange((val: boolean) => {
        stats.dom.hidden = !val;
      })
      
    const globeFolder = debugUI.addFolder('Globe')
    globeFolder.add(sphere.rotation, 'x', -Math.PI * 2, Math.PI * 2, Math.PI / 40).name('rotate x')
    globeFolder.add(sphere.rotation, 'y', -Math.PI * 2, Math.PI * 2, Math.PI / 40).name('rotate y')
    globeFolder.add(sphere.rotation, 'z', -Math.PI * 2, Math.PI * 2, Math.PI / 40).name('rotate z')

    const helpersFolder = debugUI.addFolder('Helpers')
    helpersFolder.add(axesHelper, 'visible').name('axes')
    debugUI.close()

    // Reset and persistence
    const resetGui = () => {
      localStorage.removeItem(saveName)
      gui.reset()
    }
    gui.add({ resetGui }, 'resetGui').name('RESET')

    gui.onFinishChange(() => {
      const guiState = gui.save()
      localStorage.setItem(saveName, JSON.stringify(guiState))
    })

    const guiState = localStorage.getItem(saveName)
    if (guiState) gui.load(JSON.parse(guiState))
  }

  // Handle window resize and orientation changes
  {
    const handleResize = createResizeHandler(() => {
      camera.aspect = canvas.clientWidth / canvas.clientHeight
      camera.updateProjectionMatrix()
      resizeRendererToDisplaySize(renderer)
      
      const currentDataset = props.dataset
      setupColormap(currentDataset)
      
      const viewport = getViewportDimensions();
      const aspectRatio = viewport.ratio;
      
      if (isMobile()) {
        const minDist = aspectRatio < 1 ? 2.0 : 1.5;
        const maxDist = aspectRatio < 1 ? 10 : 8;
        cameraControls.minDistance = minDist
        cameraControls.maxDistance = maxDist
        
        if (!mobileMenuButton) {
          createMobileMenuToggle()
        }
        
        if (gui) {
          const newWidth = Math.min(280, window.innerWidth - 40)
          gui.domElement.style.width = `${newWidth}px`
        }
      } else {
        const minDist = aspectRatio < 1.2 ? 1.5 : 1.2;
        const maxDist = aspectRatio < 1.2 ? 12 : 10;
        cameraControls.minDistance = minDist
        cameraControls.maxDistance = maxDist
        
        if (mobileMenuButton) {
          mobileMenuButton.remove()
          mobileMenuButton = null
        }
      }
    }, 150)
    
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 200)
    })
  }

  // Loaded
  loadingComplete()
}

function loadingComplete() {
  const date = document.getElementById('topdate')
  if (date) {
    date.innerHTML = `Date: ${assets.sstMetadata.date}`
  }
  document.getElementsByClassName('loading').item(0)?.setAttribute('hidden', 'true')
  
  if (isMobile() && !mobileMenuButton) {
    createMobileMenuToggle()
  }
}

function createMobileMenuToggle() {
  if (mobileMenuButton) {
    return;
  }
  
  if (!isMobile()) {
    return;
  }
  
  const sceneWrapper = document.getElementById('scene-wrapper')
  if (!sceneWrapper) {
    return
  }
  
  mobileMenuButton = document.createElement('button')
  mobileMenuButton.className = 'mobile-menu-toggle'
  mobileMenuButton.innerHTML = 'Options'
  mobileMenuButton.addEventListener('click', () => toggleMobileMenu())
  
  sceneWrapper.appendChild(mobileMenuButton)
}

function toggleMobileMenu(forceState?: boolean) {
  const guiElement = document.getElementById('gui')
  if (!guiElement) return
  
  const isVisible = guiElement.classList.contains('visible')
  const shouldShow = forceState !== undefined ? forceState : !isVisible
  
  if (shouldShow) {
    guiElement.classList.add('visible')
    if (mobileMenuButton) mobileMenuButton.innerHTML = 'Close'
  } else {
    guiElement.classList.remove('visible')
    if (mobileMenuButton) mobileMenuButton.innerHTML = 'Options'
  }
}

function animate() {
  requestAnimationFrame(animate)

  stats.update()

  if (animation.enabled && animation.play) {
    animations.rotate(sphere, clock, animation.speed)
  }

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }

  cameraControls.update()

  renderer.render(scene, camera)
}
