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
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
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

const animation = { enabled: false, play: true, speed: Math.PI / 10.0 }
const props = {
  landColor: new Color(0xaaaaaa),
  dataset: 'Temp Anomaly', // Temperature or Temp Anomaly
  daysAgo: 0,
  showStats: false,
}



let assets: {sstTexture: Blob|null, sstMetadata: {[Key: string]: any},
  sstAnomalyTexture: Blob|null, sstAnomalyMetadata: {[Key: string]: any}} = {
    sstTexture: null, sstMetadata: {}, sstAnomalyTexture: null, sstAnomalyMetadata: {}}

assets = await getAssets()
await init()
animate()

// Assets live in an Amazon S3 bucket, readable by everyone, sent with CORS headers
// TODO: should run this once, save results and pass to other code
async function getAssets() {
  if (!assets.sstTexture) {
    const bucketUrl = 'https://climate-change-assets.s3.amazonaws.com/sea-surface-temp/'
    let sstTextureUrl = bucketUrl + 'sst-temp-equirect.png'
    let sstMetadataUrl = bucketUrl + 'sst-temp-equirect-metadata.json'
    let sstAnomalyTextureUrl = bucketUrl + 'sst-temp-anomaly-equirect.png'
    let sstAnomalyMetadataUrl = bucketUrl + 'sst-temp-anomaly-equirect-metadata.json'

    console.log('Loading all assets...')
    let [sstTextureResult, sstMetadataResult,
      sstAnomalyTextureResult, sstAnomalyMetadataResult] =
        await Promise.all([fetch(sstTextureUrl),
          fetch(sstMetadataUrl),
          fetch(sstAnomalyTextureUrl),
          fetch(sstAnomalyMetadataUrl)]);
    console.log('Assets loaded. Unpacking...')
    assets = {
      sstTexture: await sstTextureResult.blob(),
      sstMetadata: await sstMetadataResult.json(),
      sstAnomalyTexture: await sstAnomalyTextureResult.blob(),
      sstAnomalyMetadata: await sstAnomalyMetadataResult.json(),
    }
    console.log('Assets loaded and unpacked.', assets)
  }
  return assets
}

async function loadTexture(datasetName: String) {
  let textureUrl: string

  const data = await getAssets()
  if (datasetName == 'Temperature')
    textureUrl = URL.createObjectURL(data.sstTexture as Blob)
  else if (datasetName == 'Temp Anomaly')
    textureUrl = URL.createObjectURL(data.sstAnomalyTexture as Blob)
  else
    textureUrl = `no-url-for-dataset-${datasetName}`

  // Try to load the texture from the texture URL (Blob), or re-use cached one if available
  try {
    texture = await textureLoader.loadAsync(textureUrl)
    texture.needsUpdate = true
    saveTextureToLocalStorage(texture)
  } catch (err) {
    try {
      console.warn(`Unable to load temperature map: ${err}. Reusing cached map.`)
      texture = await getLastTextureFromLocalStorage()
    }
    catch (err) {
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
    const m = sphere.material as ShaderMaterial
    m.uniforms.tex.value = texture // set it into the shader's uniform; doesn't get picked up automatically
    m.uniforms.earthTex.value = earthTexture
  } else {
    console.log(`Not updating sphere material, sphere=${sphere}`)
  }
}

async function setupColormap(datasetName: String) {
  const data = await getAssets()
  let domains, ranges, cells, title, format
  console.log(`Setting up colormap for ${datasetName} dataset`)
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
  var linear = d3.scaleLinear()
    .domain(domains)
    .range(ranges);

  var svg = d3.select("#colormap");
  svg.empty()               // remove old content

  svg.append("g")
    .attr("class", "legendLinear")
    .attr("transform", "translate(10, 15)");

  var legendLinear = legendColor()
    .shapeWidth(30)
    .cells(cells)
    .labelFormat(d3.format(format))
    .orient('horizontal')
    .title(title)
    .scale(linear);

  svg.select(".legendLinear")
    .call(legendLinear);
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

    loadingManager.onStart = () => {
      console.log('loading started')
    }
    loadingManager.onProgress = (url, loaded, total) => {
      console.log('loading in progress:')
      console.log(`${url} -> ${loaded} / ${total}`)
    }
    loadingManager.onLoad = () => {
      console.log('loaded!')
    }
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

    const radius = 1
    const sphereGeometry = new SphereGeometry(radius, 101, 101)
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
                // vec4 bgColor = vec4(color, 1.0);
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
    camera.position.set(2, 1, 2)
  }

  // ===== 🕹️ CONTROLS =====
  {
    cameraControls = new OrbitControls(camera, canvas)
    cameraControls.target = sphere.position.clone()
    cameraControls.enableDamping = true
    cameraControls.autoRotate = false
    cameraControls.update()

    // Full screen
    window.addEventListener('dblclick', (event) => {
      if (event.target === canvas) {
        toggleFullScreen(canvas)
      }
    })
  }

  // ===== 🪄 HELPERS =====
  {
    axesHelper = new AxesHelper(4)
    axesHelper.visible = false
    scene.add(axesHelper)

    // pointLightHelper = new PointLightHelper(pointLight, undefined, 'orange')
    // pointLightHelper.visible = false
    // scene.add(pointLightHelper)

    const gridHelper = new GridHelper(20, 20, 'teal', 'darkgray')
    gridHelper.position.y = -0.01
    scene.add(gridHelper)
  }

  // ===== 📈 STATS & CLOCK =====
  {
    clock = new Clock()
    stats = new Stats()
    // default positioning is fixed, top=0, left=0
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
    const top = document.getElementById('scene-wrapper')
    gui = new GUI({ title: 'Options', width: 300, container: top! })
    gui.domElement.id = 'gui'

    const saveName = 'mainUiState'
    const animateGlobe = false  // if false, animate using camera

    gui.add(props, 'dataset', ['Temperature', 'Temp Anomaly'])
      .name('Dataset')
      .onChange(async (val: String) => {
        await Promise.all([setupColormap(val), loadTexture(val)]);
      })
    if (animateGlobe) {
      gui.add(animation, 'enabled').name('Auto Rotate')
      gui.add(animation, 'speed', 0, Math.PI / 4, Math.PI / 400).name('Auto Rotate Speed')
    } else {
      gui.add(cameraControls, 'autoRotate').name('Auto Rotate')
      gui.add(cameraControls, 'autoRotateSpeed', 0, 5, 0.1).name('Auto Rotate Speed')

    }
    gui.addColor(props, 'landColor').name('Land Color')

    // ==== 🐞 DEBUG GUI ====
    {
      const debugUI = gui.addFolder('🐞 Details/Debug')

      debugUI.add(props, 'showStats')
        .name("Show FPS Stats")
        .onChange((val: boolean) => {
          stats.dom.hidden = !val;
        })
      const cubeOneFolder = debugUI.addFolder('Globe')

      // cubeOneFolder.add(sphere.position, 'x').min(-5).max(5).step(0.5).name('pos x')
      // cubeOneFolder.add(sphere.position, 'y').min(-5).max(5).step(0.5).name('pos y')
      // cubeOneFolder.add(sphere.position, 'z').min(-5).max(5).step(0.5).name('pos z')

      cubeOneFolder
        .add(sphere.rotation, 'x', -Math.PI * 2, Math.PI * 2, Math.PI / 40)
        .name('rotate x')
      cubeOneFolder
        .add(sphere.rotation, 'y', -Math.PI * 2, Math.PI * 2, Math.PI / 40)
        .name('rotate y')
      cubeOneFolder
        .add(sphere.rotation, 'z', -Math.PI * 2, Math.PI * 2, Math.PI / 40)
        .name('rotate z')

      // const lightsFolder = debugUI.addFolder('Lights')
      // lightsFolder.add(pointLight, 'visible').name('point light')
      // lightsFolder.add(ambientLight, 'visible').name('ambient light')

      const helpersFolder = debugUI.addFolder('Helpers')
      helpersFolder.add(axesHelper, 'visible').name('axes')
      // helpersFolder.add(pointLightHelper, 'visible').name('pointLight')

      debugUI.close()
    }

    // reset GUI state button
    const resetGui = () => {
      localStorage.removeItem(saveName)
      gui.reset()
    }
    gui.add({ resetGui }, 'resetGui').name('RESET')

    // persist GUI state in local storage on changes
    gui.onFinishChange(() => {
      const guiState = gui.save()
      localStorage.setItem(saveName, JSON.stringify(guiState))
    })

    // load GUI state if available in local storage
    const guiState = localStorage.getItem(saveName)
    if (guiState) gui.load(JSON.parse(guiState))

  }

  // Loaded
  loadingComplete()
}

function loadingComplete() {
  const date = document.getElementById('topdate')
  if (date)
    date.innerHTML = `Date: ${assets.sstMetadata.date}`
  document.getElementsByClassName('loading').item(0)?.setAttribute('hidden', 'true')
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
