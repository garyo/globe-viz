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
import { loadCoastlines, type CoastlineOverlay } from '../lib/scene/coastlines';
import { fetchDatasetAssets } from '../lib/data/assets';
import { TextureCache } from '../lib/data/textureCache';
import { Spherical, Vector3 } from 'three';
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
  let coastlines: CoastlineOverlay | undefined;
  let axesHelper: AxesHelper;
  let stats: Stats;
  let animationId: number;
  let textureLoader: ReturnType<typeof createTextureLoader>;
  let errorTimeout: number | undefined;
  let animationTimeout: number | undefined;
  let cleanupFullscreen: (() => void) | undefined;
  let cleanupResize: (() => void) | undefined;
  let cleanupWheelRotate: (() => void) | undefined;

  // Texture cache to avoid re-fetching from S3 (max a couple of years per
  // (source, dataset) tuple — 2× datasets × 2 years ≈ 1500 entries upper bound).
  const textureCache = new TextureCache(366 * 2);

  // Track the most recently requested asset to avoid displaying stale loads.
  let currentLoadRequestId = 0;

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

    // Load initial globe with whatever AppLoader pre-fetched.
    const initialTexture = appState.assets[appState.dataset]?.texture;
    if (initialTexture) {
      const result = await createGlobe(textureLoader, initialTexture);
      globe = result.mesh;
      scene.add(globe);

      // Create controls (needs globe position for target)
      controls = createControls(camera, canvasRef, globe.position);
      controls.autoRotate = appState.autoRotate;
      controls.autoRotateSpeed = appState.autoRotateSpeed;

      // Coastline overlay: subtle screen-space line above the globe surface
      // (radius 1.001 to avoid z-fighting with the unit-radius sphere).
      try {
        coastlines = await loadCoastlines('/coastlines-110m.json', {
          radius: 1.001,
          color: 0x202020,
          linewidth: 1.0,
          opacity: 0.5,
        });
        scene.add(coastlines.line);
      } catch (err) {
        console.warn('Failed to load coastlines:', err);
      }
    }

    cleanupFullscreen = setupFullscreenHandlers();
    cleanupResize = setupResizeHandler();
    cleanupWheelRotate = setupWheelRotation();

    animate();
  });

  onCleanup(() => {
    if (animationId) cancelAnimationFrame(animationId);
    if (renderer) renderer.dispose();
    if (controls) controls.dispose();
    if (errorTimeout) clearTimeout(errorTimeout);
    if (animationTimeout) clearTimeout(animationTimeout);
    if (cleanupFullscreen) cleanupFullscreen();
    if (cleanupResize) cleanupResize();
    if (cleanupWheelRotate) cleanupWheelRotate();
    if (coastlines) coastlines.dispose();
    textureCache.clear();
  });

  // Swap globe texture instantly when the user toggles dataset.
  // Source-change is handled by the date-loading effect below (which refetches
  // because the cache miss yields a network round-trip).
  createEffect(() => {
    const dataset = appState.dataset;
    const slot = appState.assets[dataset];
    const dataTexture = slot?.texture;
    if (!globe) return;
    if (dataTexture) updateGlobeTexture(globe, dataTexture);
  });

  // React to auto-rotate changes
  createEffect(() => {
    const autoRotate = appState.autoRotate;
    const autoRotateSpeed = appState.autoRotateSpeed;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = autoRotateSpeed;
  });

  createEffect(() => {
    if (!stats) return;
    stats.dom.hidden = !appState.showStats;
  });

  createEffect(() => {
    if (!axesHelper) return;
    axesHelper.visible = appState.showAxes;
  });

  // React to date / source / dataset changes — load fresh texture for the
  // current (source, dataset, date) tuple. The dataset-toggle effect above
  // handles in-memory swaps; this one handles fetch-on-cache-miss.
  createEffect(() => {
    // Track reactive values
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;
    const source = appState.source;
    const dataset = appState.dataset;
    const isAnimating = appState.isAnimating;
    const animationSpeed = appState.animationSpeed;

    if (availableDates.length === 0 || !globe || !textureLoader || !renderer) return;

    const date = availableDates[currentDateIndex];
    if (!date) return;

    // Seed cache with AppLoader's preloaded asset for this date, if it's the
    // right (source, dataset). Only matches when the user hasn't navigated
    // away from the initial latest date and source.
    if (!textureCache.has(date, source, dataset)) {
      const slot = appState.assets[dataset];
      if (
        slot?.texture &&
        slot.metadata?.date === date &&
        slot.source === source
      ) {
        textureCache.set(date, source, dataset, {
          texture: slot.texture,
          metadata: slot.metadata,
        });
      }
    }

    // Clear any pending animation timeout (in case user manually changed frame)
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = undefined;
    }

    // Load assets for the selected (date, source, dataset) — check cache first.
    const requestId = ++currentLoadRequestId;

    void (async () => {
      try {
        let assets = textureCache.get(date, source, dataset);

        if (!assets) {
          assets = await fetchDatasetAssets(date, source, dataset, textureLoader);
          renderer.initTexture(assets.texture);
          textureCache.set(date, source, dataset, assets);
        }

        // Only update display if this is still the most recent request.
        if (requestId !== currentLoadRequestId) {
          console.log(`Skipping stale load for ${date}/${source}/${dataset}`);
          return;
        }

        setAppState('assets', dataset, {
          texture: assets.texture,
          metadata: assets.metadata,
          source,
        });

        if (errorTimeout) {
          clearTimeout(errorTimeout);
          errorTimeout = undefined;
        }
        setAppState('missingDateError', null);

        // If animating, schedule next frame after this texture loads.
        if (isAnimating && availableDates.length > 1) {
          const nextIndex = (currentDateIndex + 1) % availableDates.length;
          const nextDate = availableDates[nextIndex];

          const advanceFrame = () => {
            setAppState('currentDateIndex', (prev) => {
              const next = prev + 1;
              return next >= availableDates.length ? 0 : next;
            });
          };

          const isAtEnd = currentDateIndex === availableDates.length - 1;
          const baseDelay = isAtEnd ? animationSpeed + 1000 : animationSpeed;

          if (textureCache.has(nextDate, source, dataset)) {
            animationTimeout = window.setTimeout(advanceFrame, baseDelay);
          } else {
            const checkNextFrame = async () => {
              try {
                let attempts = 0;
                const maxAttempts = 100; // 10s max wait
                while (
                  !textureCache.has(nextDate, source, dataset) &&
                  attempts < maxAttempts
                ) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  attempts++;
                }
                if (appState.isAnimating) advanceFrame();
              } catch (err) {
                console.error('Error waiting for next frame:', err);
                if (appState.isAnimating) advanceFrame();
              }
            };
            animationTimeout = window.setTimeout(() => {
              void checkNextFrame();
            }, baseDelay);
          }
        }
      } catch (err) {
        console.error(`Failed to load ${source}/${dataset} for ${date}:`, err);
        setAppState('missingDateError', `Data unavailable for ${date}`);
        if (errorTimeout) clearTimeout(errorTimeout);
        errorTimeout = window.setTimeout(() => {
          setAppState('missingDateError', null);
        }, 3000);
        if (isAnimating) setAppState('isAnimating', false);
      }
    })();
  });

  // Pre-load the next date's (source, dataset) tuple while animating.
  createEffect(() => {
    const isAnimating = appState.isAnimating;
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;
    const source = appState.source;
    const dataset = appState.dataset;

    if (!isAnimating || availableDates.length <= 1 || !textureLoader || !renderer) return;

    const nextIndex = (currentDateIndex + 1) % availableDates.length;
    const nextDate = availableDates[nextIndex];
    if (!nextDate) return;

    if (!textureCache.has(nextDate, source, dataset)) {
      void (async () => {
        try {
          const assets = await fetchDatasetAssets(nextDate, source, dataset, textureLoader);
          renderer.initTexture(assets.texture);
          textureCache.set(nextDate, source, dataset, assets);
        } catch {
          // Silent: prefetch is best-effort
        }
      })();
    }
  });

  function animate() {
    animationId = requestAnimationFrame(animate);

    if (stats) stats.update();

    if (resizeRendererToDisplaySize(renderer)) {
      updateCameraAspect(camera, renderer.domElement);
      if (coastlines) {
        coastlines.setResolution(renderer.domElement.width, renderer.domElement.height);
      }
    }

    if (controls) controls.update();

    renderer.render(scene, camera);
  }

  function setupFullscreenHandlers() {
    if (!canvasRef) return;

    let lastTouchTime = 0;

    const handleDoubleClick = (event: MouseEvent) => {
      if (event.target === canvasRef) {
        toggleFullScreen(canvasRef!);
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTouchTime;
      if (tapLength < 500 && tapLength > 0) {
        event.preventDefault();
        toggleFullScreen(canvasRef!);
      }
      lastTouchTime = currentTime;
    };

    window.addEventListener('dblclick', handleDoubleClick);
    canvasRef.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('dblclick', handleDoubleClick);
      canvasRef?.removeEventListener('touchend', handleTouchEnd);
    };
  }

  function setupResizeHandler() {
    const handleResize = createResizeHandler(() => {
      updateCameraAspect(camera, renderer.domElement);
      if (controls) {
        updateControlsForResize(controls);
      }
    }, 150);

    const handleOrientationChange = () => {
      setTimeout(handleResize, 200);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }

  function setupWheelRotation() {
    if (!canvasRef) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle horizontal scroll (deltaX)
      if (Math.abs(e.deltaX) < 1) return;

      // Rotate the camera around the globe
      if (controls) {
        e.preventDefault();

        const rotationSpeed = 0.001;
        const rotationAmount = -e.deltaX * rotationSpeed;

        const spherical = new Spherical();
        spherical.setFromVector3(camera.position.clone().sub(controls.target));
        spherical.theta += rotationAmount;

        const newPosition = new Vector3();
        newPosition.setFromSpherical(spherical);
        newPosition.add(controls.target);

        camera.position.copy(newPosition);
        camera.lookAt(controls.target);
        controls.update();
      }
    };

    canvasRef.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvasRef?.removeEventListener('wheel', handleWheel);
    };
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
