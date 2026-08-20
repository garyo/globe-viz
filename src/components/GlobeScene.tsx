import { onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js';
import {
  appState,
  setAppState,
  consumePendingCameraFromUrl,
  selectableDates,
  currentSelectableIndex,
  setSelectableIndex,
  nextSelectableIndex,
  getCurrentDate,
  type PickedPoint,
} from '../stores/appState';
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
import {
  createCamera,
  createControls,
  updateCameraAspect,
  refitCameraForResize,
  getCameraOrbit,
  applyCameraOrbit,
  setCameraOrbitProvider,
} from '../lib/scene/camera';
import { createGlobe, updateGlobeTexture } from '../lib/scene/globe';
import { loadCoastlines, type CoastlineOverlay } from '../lib/scene/coastlines';
import { fetchDatasetAssets } from '../lib/data/assets';
import { TextureCache } from '../lib/data/textureCache';
import { spherePointToLatLon } from '../lib/scene/geo';
import { createPickMarker, type PickMarker } from '../lib/scene/pickMarker';
import { readPointValues, type ReadoutRow } from '../lib/data/pointReadout';
import { loadPlaces, lookupPlace, refinePlaceName } from '../lib/geo/places';
import { PickPopup } from './PickPopup';
import { Raycaster, Sphere, Spherical, Vector2, Vector3 } from 'three';
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
  let cleanupPointerPick: (() => void) | undefined;
  let pickMarker: PickMarker | undefined;

  // Point readout (click-to-inspect). Kept as local signals rather than store
  // fields because only this component and its popup ever look at them.
  const [readoutRows, setReadoutRows] = createSignal<ReadoutRow[]>([]);
  const [placeName, setPlaceName] = createSignal<string | null>(null);

  /**
   * The picked point as a plain object, read through its scalar fields.
   *
   * Two reasons not to use `appState.pickedPoint` directly. Solid's setStore
   * *merges* a plain object into the existing one, so the store proxy for the
   * point keeps its identity forever — subscribing to `lat`/`lon` is what
   * actually notices a move. And the async sampling below holds this value
   * across awaits, where a live proxy would mutate out from under it when the
   * user picks somewhere else.
   */
  const pickedPointSnapshot = (): PickedPoint | null => {
    const lat = appState.pickedPoint?.lat;
    const lon = appState.pickedPoint?.lon;
    return lat === undefined || lon === undefined ? null : { lat, lon };
  };

  // Texture cache to avoid re-fetching from S3 (max a couple of years per
  // (source, dataset) tuple — 2× datasets × 2 years ≈ 1500 entries upper bound).
  const textureCache = new TextureCache(366 * 2);

  // Track the most recently requested asset to avoid displaying stale loads.
  let currentLoadRequestId = 0;

  // Same idea for the point readout: a new pick (or a date change) invalidates
  // whatever the previous run is still waiting on.
  let readoutRequestId = 0;
  let placeRequestId = 0;
  let readoutTimeout: number | undefined;
  let lastReadoutPoint: PickedPoint | null = null;

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

      // Restore a share-link camera, and let the share button snapshot the
      // live framing without reaching into this component.
      const urlCamera = consumePendingCameraFromUrl();
      if (urlCamera) applyCameraOrbit(camera, controls, canvasRef, urlCamera);
      setCameraOrbitProvider(() => getCameraOrbit(camera, controls, canvasRef!));

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

    pickMarker = createPickMarker(scene);

    cleanupFullscreen = setupFullscreenHandlers();
    cleanupResize = setupResizeHandler();
    cleanupWheelRotate = setupWheelRotation();
    cleanupPointerPick = setupPointerPick();

    animate();
  });

  onCleanup(() => {
    setCameraOrbitProvider(null);
    if (animationId) cancelAnimationFrame(animationId);
    if (renderer) renderer.dispose();
    if (controls) controls.dispose();
    if (errorTimeout) clearTimeout(errorTimeout);
    if (animationTimeout) clearTimeout(animationTimeout);
    if (cleanupFullscreen) cleanupFullscreen();
    if (cleanupResize) cleanupResize();
    if (cleanupWheelRotate) cleanupWheelRotate();
    if (cleanupPointerPick) cleanupPointerPick();
    if (readoutTimeout) clearTimeout(readoutTimeout);
    if (coastlines) coastlines.dispose();
    if (pickMarker) pickMarker.dispose();
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

        // If animating, schedule next frame after this texture loads. Iterate
        // the current dataset's dates (not the union) so playback ends at the
        // dataset's real latest and skips days it has no texture for.
        const selDates = selectableDates();
        if (isAnimating && selDates.length > 1) {
          const selIdx = currentSelectableIndex();
          const nextSelIdx = nextSelectableIndex(selIdx);
          const nextDate = selDates[nextSelIdx];

          const advanceFrame = () => setSelectableIndex(nextSelIdx);

          const isAtEnd = selIdx === selDates.length - 1;
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

  // Move the scene marker to the picked point and name the place under it.
  createEffect(() => {
    const point = pickedPointSnapshot();
    if (!point) {
      pickMarker?.setVisible(false);
      setPlaceName(null);
      return;
    }
    pickMarker?.moveTo(point);

    setPlaceName(null);
    const requestId = ++placeRequestId;
    void (async () => {
      // Two stages: the bundled polygons answer immediately, then the online
      // geocoder refines it (small islands and territories, mostly).
      const index = await loadPlaces();
      if (requestId !== placeRequestId) return;  // point moved while loading
      const offline = index ? lookupPlace(index, point.lat, point.lon) : null;
      setPlaceName(offline);

      const best = await refinePlaceName(point.lat, point.lon, offline);
      if (requestId === placeRequestId) setPlaceName(best);
    })();
  });

  // Sample every available dataset at the picked point. Re-runs when the date
  // moves, so the readout stays live while scrubbing or playing.
  createEffect(() => {
    const point = pickedPointSnapshot();
    const date = appState.availableDates[appState.currentDateIndex];
    const isAnimating = appState.isAnimating;

    if (readoutTimeout) {
      clearTimeout(readoutTimeout);
      readoutTimeout = undefined;
    }
    if (!point || !date || !textureLoader) {
      lastReadoutPoint = point;
      setReadoutRows([]);
      return;
    }

    const isNewPoint =
      lastReadoutPoint?.lat !== point.lat || lastReadoutPoint?.lon !== point.lon;
    lastReadoutPoint = point;

    const requestId = ++readoutRequestId;
    const isCurrent = () => requestId === readoutRequestId;
    const run = () => {
      readoutTimeout = undefined;
      void readPointValues(point, date, textureCache, textureLoader, {
        // Never fetch mid-playback: at up to 11 datasets per frame that would
        // swamp the network and evict the animation's own textures. Scrubbing
        // by hand is debounced instead, so it costs one batch once you settle.
        allowFetch: isNewPoint || !isAnimating,
        onUpdate: (rows) => { if (isCurrent()) setReadoutRows(rows); },
        isCurrent,
      });
    };

    // Debounce only a hand scrub, where each slider step would otherwise cost a
    // round of fetches. Playback must sample every frame instead: at 10 fps the
    // date changes faster than any debounce expires, so a timer here would
    // never fire and the values would sit frozen while the date label ticked
    // on — reading as real data. Sampling is cache-only while animating, so
    // it's a canvas read per frame and no network.
    if (isNewPoint || isAnimating) run();
    else readoutTimeout = window.setTimeout(run, 200);
  });

  // Pre-load the next date's (source, dataset) tuple while animating.
  createEffect(() => {
    const isAnimating = appState.isAnimating;
    const source = appState.source;
    const dataset = appState.dataset;
    const selDates = selectableDates();

    if (!isAnimating || selDates.length <= 1 || !textureLoader || !renderer) return;

    const nextIndex = nextSelectableIndex(currentSelectableIndex());
    const nextDate = selDates[nextIndex];
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
      if (controls) refitCameraForResize(camera, controls, renderer.domElement);
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
        // The first tap of the pair already opened a readout; going fullscreen
        // is clearly not a request to inspect that point.
        setAppState('pickedPoint', null);
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
        refitCameraForResize(camera, controls, renderer.domElement);
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

  /**
   * Click (or tap) the globe to pin a point for the readout; click the
   * background to dismiss it.
   */
  function setupPointerPick() {
    if (!canvasRef) return;

    const raycaster = new Raycaster();
    const globeSphere = new Sphere(new Vector3(0, 0, 0), 1);
    const ndc = new Vector2();
    const hit = new Vector3();

    const MAX_DRIFT_PX = 5;
    const MAX_DURATION_MS = 500;
    let down: { x: number; y: number; at: number } | undefined;

    const handlePointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, at: performance.now() };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const start = down;
      down = undefined;
      if (!start || !camera || !canvasRef) return;
      // Separate a pick from an orbit drag, and from the second click of the
      // double-click that toggles fullscreen.
      if (e.detail > 1) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_DRIFT_PX) return;
      if (performance.now() - start.at > MAX_DURATION_MS) return;

      const rect = canvasRef.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      // Intersect the analytic sphere rather than the mesh: SphereGeometry is a
      // 101×101 tessellation whose flat facets sit measurably inside the true
      // surface near the silhouette, which is exactly where picking is
      // touchiest. The globe is untransformed at the origin, so world space and
      // globe space coincide.
      const point = raycaster.ray.intersectSphere(globeSphere, hit);
      setAppState('pickedPoint', point ? spherePointToLatLon(point) : null);
    };

    canvasRef.addEventListener('pointerdown', handlePointerDown);
    canvasRef.addEventListener('pointerup', handlePointerUp);

    return () => {
      canvasRef?.removeEventListener('pointerdown', handlePointerDown);
      canvasRef?.removeEventListener('pointerup', handlePointerUp);
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
      <Show when={pickedPointSnapshot()}>
        {(point) => (
          <PickPopup
            point={point()}
            place={placeName()}
            date={getCurrentDate()}
            rows={readoutRows()}
            isAnimating={appState.isAnimating}
            onClose={() => setAppState('pickedPoint', null)}
          />
        )}
      </Show>
    </div>
  );
};
