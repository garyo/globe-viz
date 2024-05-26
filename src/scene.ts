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
  MeshStandardMaterial,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  PointLightHelper,
  Scene,
  TextureLoader,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  ShaderMaterial,
  Color,
  LinearSRGBColorSpace,
} from 'three'
import { DragControls } from 'three/examples/jsm/controls/DragControls'
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
let camera: PerspectiveCamera
let cameraControls: OrbitControls
let dragControls: DragControls
let axesHelper: AxesHelper
let pointLightHelper: PointLightHelper
let clock: Clock
let stats: Stats
let gui: GUI

const animation = { enabled: false, play: true, speed: Math.PI / 10.0 }
const props = { landColor: new Color(0xaaaaaa)}


init()
animate()

function init() {
  // ===== 🖼️ CANVAS, RENDERER, & SCENE =====
  {
    ColorManagement.enabled = true
    canvas = document.querySelector(`canvas#${CANVAS_ID}`)!
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    // renderer.outputEncoding = sRGBEncoding
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
    pointLight = new PointLight('white', 20, 100)
    pointLight.position.set(-2, 2, 2)
    pointLight.castShadow = true
    pointLight.shadow.radius = 4
    pointLight.shadow.camera.near = 0.5
    pointLight.shadow.camera.far = 4000
    pointLight.shadow.mapSize.width = 2048
    pointLight.shadow.mapSize.height = 2048
    scene.add(ambientLight)
    scene.add(pointLight)
  }

  // ===== 📦 OBJECTS =====
  {

    const sideLength = 1
    const sphereGeometry = new SphereGeometry(sideLength, 101, 101)
    // const cubeMaterial = new MeshStandardMaterial({
    //   color: '#f69f1f',
    //   metalness: 0.5,
    //   roughness: 0.7,
    // })
    const textureLoader = new TextureLoader();
    const texture = textureLoader.load('/texture.png');
    texture.colorSpace = LinearSRGBColorSpace

    // A material that blends the transparent texture with a fixed color
    const textureMaterial = new ShaderMaterial({
        uniforms: {
            tex: { value: texture },
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
            uniform vec3 color;
            varying vec2 vUv;
            void main() {
                vec4 texColor = texture2D(tex, vUv);
                gl_FragColor = mix(vec4(color, 1.0), texColor, texColor.a);
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

  const useDragControls = false

  // ===== 🕹️ CONTROLS =====
  {
    cameraControls = new OrbitControls(camera, canvas)
    cameraControls.target = sphere.position.clone()
    cameraControls.enableDamping = true
    cameraControls.autoRotate = false
    cameraControls.update()

    if (useDragControls) {
      dragControls = new DragControls([sphere], camera, renderer.domElement)
      dragControls.addEventListener('hoveron', (event) => {
        const mesh = event.object as Mesh
        const material = mesh.material as ShaderMaterial
        // material.emissive.set('orange')
      })
      dragControls.addEventListener('hoveroff', (event) => {
        const mesh = event.object as Mesh
        const material = mesh.material as ShaderMaterial
        // material.emissive.set('black')
      })
      dragControls.addEventListener('dragstart', (event) => {
        const mesh = event.object as Mesh
        const material = mesh.material as ShaderMaterial
        cameraControls.enabled = false
        animation.play = false
        // material.emissive.set('black')
        // material.opacity = 0.7
        // material.needsUpdate = true
      })
      dragControls.addEventListener('dragend', (event) => {
        cameraControls.enabled = true
        animation.play = true
        const mesh = event.object as Mesh
        const material = mesh.material as ShaderMaterial
        // material.emissive.set('black')
        // material.opacity = 1
        // material.needsUpdate = true
      })
      dragControls.enabled = false
    }

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

    pointLightHelper = new PointLightHelper(pointLight, undefined, 'orange')
    pointLightHelper.visible = false
    scene.add(pointLightHelper)

    const gridHelper = new GridHelper(20, 20, 'teal', 'darkgray')
    gridHelper.position.y = -0.01
    scene.add(gridHelper)
  }

  // ===== 📈 STATS & CLOCK =====
  {
    clock = new Clock()
    stats = new Stats()
    document.body.appendChild(stats.dom)
  }

  let showDebugUI = true

  // ==== MAIN GUI ====
  {
    gui = new GUI({ title: 'Options', width: 300 })
    const saveName = 'mainUiState'
    const animateGlobe = false  // if false, animate using camera
    if (animateGlobe) {
      gui.add(animation, 'enabled').name('Auto Rotate')
      gui.add(animation, 'speed', 0, Math.PI / 4, Math.PI / 400).name('Auto Rotate Speed')
    } else {
      gui.add(cameraControls, 'autoRotate').name('Auto Rotate')
      gui.add(cameraControls, 'autoRotateSpeed', 0, 5, 0.1).name('Auto Rotate Speed')

    }
    gui.addColor(props, 'landColor').name('Land Color')

    // persist GUI state in local storage on changes
    gui.onFinishChange(() => {
      const guiState = gui.save()
      localStorage.setItem(saveName, JSON.stringify(guiState))
    })

    // load GUI state if available in local storage
    const guiState = localStorage.getItem(saveName)
    if (guiState) gui.load(JSON.parse(guiState))


    // ==== 🐞 DEBUG GUI ====
    {
      const debugUI = gui.addFolder('🐞 Details/Debug')

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

      if (useDragControls) {
        const controlsFolder = debugUI.addFolder('Controls')
        controlsFolder.add(dragControls, 'enabled').name('drag controls')
      }

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
