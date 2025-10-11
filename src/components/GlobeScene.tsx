import { onMount, onCleanup, createEffect, Show } from 'solid-js';
import { appState, setAppState } from '../stores/appState';
import { toggleFullScreen } from '../lib/helpers/fullscreen';
import { createResizeHandler } from '../lib/helpers/responsiveness-client';
import {
  createRenderer,
  createScene,
  createLights,
  createHelpers,
  createStats,
  createTextureLoader,
  resizeRendererToDisplaySize,
} from '../lib/scene/setup';
import { createCamera, createControls, updateCameraAspect, updateControlsForResize } from '../lib/scene/camera';
import { createGlobe, updateGlobeTexture } from '../lib/scene/globe';
import { fetchAssetsForDate } from '../lib/data/assets';
import { TextureCache } from '../lib/data/textureCache';
import type { WebGLRenderer, Scene, PerspectiveCamera, Mesh, AxesHelper } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type Stats from 'three/examples/jsm/libs/stats.module';

export const GlobeScene = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  let wrapperRef: HTMLDivElement | undefined;

  let renderer: WebGLRenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let controls: OrbitControls;
  let globe: Mesh;
  let axesHelper: AxesHelper;
  let stats: Stats;
  let animationId: number;
  let textureLoader: ReturnType<typeof createTextureLoader>;
  let errorTimeout: number | undefined;

  // Texture cache to avoid re-fetching from S3 (max 100 dates)
  const textureCache = new TextureCache(100);

  onMount(async () => {
    if (!canvasRef || !wrapperRef) return;

    // Initialize Three.js scene
    renderer = createRenderer(canvasRef);
    scene = createScene();
    camera = createCamera(canvasRef);

    // Add lights and helpers
    createLights(scene);
    const helpers = createHelpers(scene);
    axesHelper = helpers.axesHelper;

    // Create stats
    stats = createStats(wrapperRef);
    stats.dom.hidden = !appState.showStats;

    // Create texture loader (reused for all texture operations)
    textureLoader = createTextureLoader();

    // Load initial globe
    const dataBlob =
      appState.dataset === 'Temperature'
        ? appState.assets.sstTexture
        : appState.assets.sstAnomalyTexture;

    if (dataBlob) {
      const result = await createGlobe(textureLoader, dataBlob);
      globe = result.mesh;
      scene.add(globe);

      // Create controls (needs globe position for target)
      controls = createControls(camera, canvasRef, globe.position);

      // Initialize controls with saved state
      controls.autoRotate = appState.autoRotate;
      controls.autoRotateSpeed = appState.autoRotateSpeed;
    }

    // Fullscreen on double-click or double-tap
    setupFullscreenHandlers();

    // Handle window resize
    setupResizeHandler();

    // Start animation loop
    animate();
  });

  onCleanup(() => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (renderer) {
      renderer.dispose();
    }
    if (controls) {
      controls.dispose();
    }
    if (errorTimeout) {
      clearTimeout(errorTimeout);
    }
  });

  // React to dataset changes
  createEffect(() => {
    // IMPORTANT: Track reactive values BEFORE any early returns
    const dataset = appState.dataset;
    const sstTexture = appState.assets.sstTexture;
    const sstAnomalyTexture = appState.assets.sstAnomalyTexture;

    // Now we can do conditional checks
    if (!globe || !textureLoader || !sstTexture) return;

    const dataBlob = dataset === 'Temperature' ? sstTexture : sstAnomalyTexture;

    if (dataBlob) {
      // Use void to handle the promise without breaking reactivity
      void updateGlobeTexture(globe, textureLoader, dataBlob);
    }
  });

  // React to auto-rotate changes
  createEffect(() => {
    // Make sure to track these values
    const autoRotate = appState.autoRotate;
    const autoRotateSpeed = appState.autoRotateSpeed;

    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = autoRotateSpeed;
  });

  // React to showStats changes
  createEffect(() => {
    if (!stats) return;
    stats.dom.hidden = !appState.showStats;
  });

  // React to showAxes changes
  createEffect(() => {
    if (!axesHelper) return;
    axesHelper.visible = appState.showAxes;
  });

  // React to date changes - load new textures
  createEffect(() => {
    // Track reactive values
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;

    if (availableDates.length === 0 || !globe || !textureLoader) return;

    const date = availableDates[currentDateIndex];
    if (!date) return;

    // Load assets for the selected date (check cache first)
    void (async () => {
      try {
        let assets = textureCache.get(date);

        if (!assets) {
          // Cache miss - fetch from S3
          assets = await fetchAssetsForDate(date);
          textureCache.set(date, assets);
        }

        setAppState('assets', {
          sstTexture: assets.sstTexture,
          sstMetadata: assets.sstMetadata,
          sstAnomalyTexture: assets.sstAnomalyTexture,
          sstAnomalyMetadata: assets.sstAnomalyMetadata,
        });

        // Clear any previous error
        if (errorTimeout) {
          clearTimeout(errorTimeout);
          errorTimeout = undefined;
        }
        setAppState('missingDateError', null);
      } catch (err) {
        console.error(`Failed to load assets for date ${date}:`, err);
        // Set error state but keep previous texture
        setAppState('missingDateError', `Data unavailable for ${date}`);
        // Don't update assets - keep showing previous date's texture

        // Auto-clear the error after 3 seconds
        if (errorTimeout) {
          clearTimeout(errorTimeout);
        }
        errorTimeout = window.setTimeout(() => {
          setAppState('missingDateError', null);
        }, 3000);
      }
    })();
  });

  // Animation timer - advance to next date at regular intervals
  createEffect(() => {
    const isAnimating = appState.isAnimating;
    const animationSpeed = appState.animationSpeed;
    const availableDates = appState.availableDates;
    const currentIndex = appState.currentDateIndex;

    if (!isAnimating || availableDates.length <= 1) return;

    // Check if we're at the last frame - pause for 1 second before looping
    const isAtEnd = currentIndex === availableDates.length - 1;
    const delay = isAtEnd ? animationSpeed + 1000 : animationSpeed;

    const timeout = setTimeout(() => {
      setAppState('currentDateIndex', (prev) => {
        const next = prev + 1;
        // Loop back to start
        return next >= availableDates.length ? 0 : next;
      });
    }, delay);

    // Cleanup timeout when effect re-runs or component unmounts
    onCleanup(() => {
      clearTimeout(timeout);
    });
  });

  // Pre-load next frame when animating (for smooth playback)
  createEffect(() => {
    const isAnimating = appState.isAnimating;
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;

    if (!isAnimating || availableDates.length <= 1) return;

    // Calculate next date index
    const nextIndex = (currentDateIndex + 1) % availableDates.length;
    const nextDate = availableDates[nextIndex];

    if (!nextDate) return;

    // Pre-load if not already cached
    if (!textureCache.has(nextDate)) {
      void (async () => {
        try {
          const assets = await fetchAssetsForDate(nextDate);
          textureCache.set(nextDate, assets);
        } catch (err) {
          // Silently fail - not critical
        }
      })();
    }
  });

  function animate() {
    animationId = requestAnimationFrame(animate);

    if (stats) stats.update();

    if (resizeRendererToDisplaySize(renderer)) {
      updateCameraAspect(camera, renderer.domElement);
    }

    if (controls) controls.update();

    renderer.render(scene, camera);
  }

  function setupFullscreenHandlers() {
    if (!canvasRef) return;

    let lastTouchTime = 0;

    window.addEventListener('dblclick', (event) => {
      if (event.target === canvasRef) {
        toggleFullScreen(canvasRef!);
      }
    });

    canvasRef.addEventListener('touchend', (event) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTouchTime;
      if (tapLength < 500 && tapLength > 0) {
        event.preventDefault();
        toggleFullScreen(canvasRef!);
      }
      lastTouchTime = currentTime;
    });
  }

  function setupResizeHandler() {
    const handleResize = createResizeHandler(() => {
      updateCameraAspect(camera, renderer.domElement);
      if (controls) {
        updateControlsForResize(controls);
      }
    }, 150);

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 200);
    });
  }

  return (
    <div ref={wrapperRef} id="scene-wrapper">
      <canvas ref={canvasRef} id="scene"></canvas>
      <Show when={appState.missingDateError}>
        <div class="missing-date-indicator">
          ⚠️ {appState.missingDateError}
        </div>
      </Show>
    </div>
  );
};
