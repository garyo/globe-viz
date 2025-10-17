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
  let axesHelper: AxesHelper;
  let stats: Stats;
  let animationId: number;
  let textureLoader: ReturnType<typeof createTextureLoader>;
  let errorTimeout: number | undefined;
  let animationTimeout: number | undefined;
  let cleanupFullscreen: (() => void) | undefined;
  let cleanupResize: (() => void) | undefined;
  let cleanupWheelRotate: (() => void) | undefined;

  // Texture cache to avoid re-fetching from S3 (max a couple of years)
  const textureCache = new TextureCache(366*2);

  // Track the most recently requested date to avoid displaying stale loads
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

    // Load initial globe
    const dataTexture =
      appState.dataset === 'Temperature'
        ? appState.assets.sstTexture
        : appState.assets.sstAnomalyTexture;

    if (dataTexture) {
      const result = await createGlobe(textureLoader, dataTexture);
      globe = result.mesh;
      scene.add(globe);

      // Create controls (needs globe position for target)
      controls = createControls(camera, canvasRef, globe.position);

      // Initialize controls with saved state
      controls.autoRotate = appState.autoRotate;
      controls.autoRotateSpeed = appState.autoRotateSpeed;
    }

    // Fullscreen on double-click or double-tap
    cleanupFullscreen = setupFullscreenHandlers();

    // Handle window resize
    cleanupResize = setupResizeHandler();

    // Handle horizontal scroll wheel rotation
    cleanupWheelRotate = setupWheelRotation();

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
    if (animationTimeout) {
      clearTimeout(animationTimeout);
    }
    if (cleanupFullscreen) {
      cleanupFullscreen();
    }
    if (cleanupResize) {
      cleanupResize();
    }
    if (cleanupWheelRotate) {
      cleanupWheelRotate();
    }
    textureCache.clear();
  });

  // React to dataset changes
  createEffect(() => {
    // IMPORTANT: Track reactive values BEFORE any early returns
    const dataset = appState.dataset;
    const sstTexture = appState.assets.sstTexture;
    const sstAnomalyTexture = appState.assets.sstAnomalyTexture;

    // Now we can do conditional checks
    if (!globe) return;

    const dataTexture = dataset === 'Temperature' ? sstTexture : sstAnomalyTexture;

    if (dataTexture) {
      // No async needed - texture is pre-decoded!
      updateGlobeTexture(globe, dataTexture);
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

  // React to date changes - load new texture for current dataset only
  // IMPORTANT: Waits for texture to load before scheduling next animation frame
  createEffect(() => {
    // Track reactive values
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;
    const dataset = appState.dataset;
    const isAnimating = appState.isAnimating;
    const animationSpeed = appState.animationSpeed;

    if (availableDates.length === 0 || !globe || !textureLoader || !renderer) return;

    const date = availableDates[currentDateIndex];
    if (!date) return;

    // Seed cache with preloaded assets from initial AppLoader fetch
    if (!textureCache.has(date, dataset)) {
      const preloadedTexture =
        dataset === 'Temperature' ? appState.assets.sstTexture : appState.assets.sstAnomalyTexture;
      const preloadedMetadata =
        dataset === 'Temperature' ? appState.assets.sstMetadata : appState.assets.sstAnomalyMetadata;

      if (preloadedTexture && preloadedMetadata?.date === date) {
        textureCache.set(date, dataset, {
          texture: preloadedTexture,
          metadata: preloadedMetadata,
        });
      }
    }

    // Clear any pending animation timeout (in case user manually changed frame)
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = undefined;
    }

    // Load assets for the selected date and current dataset (check cache first)
    // Increment request ID to track the most recent request
    const requestId = ++currentLoadRequestId;

    void (async () => {
      try {
        let assets = textureCache.get(date, dataset);

        if (!assets) {
          // Cache miss - fetch only current dataset from S3
          assets = await fetchDatasetAssets(date, dataset, textureLoader);

          // Pre-decode texture on GPU before caching
          renderer.initTexture(assets.texture);

          textureCache.set(date, dataset, assets);
        }

        // Only update display if this is still the most recent request
        // This prevents stale loads from updating the display during rapid slider dragging
        if (requestId !== currentLoadRequestId) {
          console.log(`Skipping stale load for ${date} (request ${requestId} vs current ${currentLoadRequestId})`);
          return;
        }

        // Update only the current dataset's texture and metadata
        if (dataset === 'Temperature') {
          setAppState('assets', 'sstTexture', assets.texture);
          setAppState('assets', 'sstMetadata', assets.metadata);
        } else {
          setAppState('assets', 'sstAnomalyTexture', assets.texture);
          setAppState('assets', 'sstAnomalyMetadata', assets.metadata);
        }

        // Clear any previous error
        if (errorTimeout) {
          clearTimeout(errorTimeout);
          errorTimeout = undefined;
        }
        setAppState('missingDateError', null);

        // If animating, schedule next frame AFTER texture loads.
        // This eliminates race conditions and stuttering
        if (isAnimating && availableDates.length > 1) {
          // Calculate next frame index
          const nextIndex = (currentDateIndex + 1) % availableDates.length;
          const nextDate = availableDates[nextIndex];

          // Function to advance to next frame
          const advanceFrame = () => {
            setAppState('currentDateIndex', (prev) => {
              const next = prev + 1;
              return next >= availableDates.length ? 0 : next;
            });
          };

          // Check if we're at the last frame - pause for 1 second before looping
          const isAtEnd = currentDateIndex === availableDates.length - 1;
          const baseDelay = isAtEnd ? animationSpeed + 1000 : animationSpeed;

          // Check if next frame is already cached
          if (textureCache.has(nextDate, dataset)) {
            // Next frame is ready, advance after normal delay
            animationTimeout = window.setTimeout(advanceFrame, baseDelay);
          } else {
            // Next frame not ready yet - wait for it to load before advancing
            // This prevents jittery animation when cache is cold
            const checkNextFrame = async () => {
              try {
                // Wait for next frame to be fetched and cached
                let attempts = 0;
                const maxAttempts = 100; // 10 seconds max wait
                while (!textureCache.has(nextDate, dataset) && attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  attempts++;
                }

                // If we got the frame or timed out, advance
                if (appState.isAnimating) {
                  advanceFrame();
                }
              } catch (err) {
                console.error('Error waiting for next frame:', err);
                // Advance anyway to avoid getting stuck
                if (appState.isAnimating) {
                  advanceFrame();
                }
              }
            };

            // Start checking after the base delay
            animationTimeout = window.setTimeout(() => {
              void checkNextFrame();
            }, baseDelay);
          }
        }
      } catch (err) {
        console.error(`Failed to load ${dataset} for date ${date}:`, err);
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

        // On error, stop animation to avoid infinite loop
        if (isAnimating) {
          setAppState('isAnimating', false);
        }
      }
    })();
  });

  // Animation is now handled in the texture loading effect above
  // This ensures each frame waits for its texture to load before advancing
  // Eliminates race conditions and stuttering at high frame rates

  // Pre-load next frame when animating (for smooth playback)
  // Only pre-fetch current dataset to save memory
  createEffect(() => {
    const isAnimating = appState.isAnimating;
    const currentDateIndex = appState.currentDateIndex;
    const availableDates = appState.availableDates;
    const dataset = appState.dataset;

    if (!isAnimating || availableDates.length <= 1 || !textureLoader || !renderer) return;

    // Calculate next date index
    const nextIndex = (currentDateIndex + 1) % availableDates.length;
    const nextDate = availableDates[nextIndex];

    if (!nextDate) return;

    // Pre-load if not already cached (only for current dataset)
    if (!textureCache.has(nextDate, dataset)) {
      void (async () => {
        try {
          const assets = await fetchDatasetAssets(nextDate, dataset, textureLoader);

          // CRITICAL: Pre-decode texture on GPU NOW, before it's needed
          // This eliminates decode stutter during animation!
          renderer.initTexture(assets.texture);

          textureCache.set(nextDate, dataset, assets);
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
        // Prevent default horizontal scroll
        e.preventDefault();

        // Adjust azimuthal angle (rotation around vertical axis)
        // Positive deltaX = scroll right = rotate globe right (camera moves left)
        // Scale the rotation speed (geared down for smooth control)
        const rotationSpeed = 0.001;
        const rotationAmount = -e.deltaX * rotationSpeed;

        // Get current spherical coordinates
        const spherical = new Spherical();
        spherical.setFromVector3(camera.position.clone().sub(controls.target));

        // Adjust azimuthal angle (theta)
        spherical.theta += rotationAmount;

        // Convert back to Cartesian and update camera
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
