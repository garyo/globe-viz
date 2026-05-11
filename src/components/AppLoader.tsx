import { createSignal, onMount, onCleanup, Show, type Component } from 'solid-js';
import {
  setAppState,
  appState,
  DATASETS_BY_SOURCE,
  isValidDataset,
  defaultDatasetFor,
  type SourceId,
} from '../stores/appState';
import { fetchDateIndex, fetchDatasetAssets } from '../lib/data/assets';
import { TextureLoader } from 'three';
import { AppTabs } from './AppTabs';
import { KeyboardControls } from './KeyboardControls';

const KNOWN_SOURCES: SourceId[] = ['oisst', 'era5'];

export const AppLoader: Component = () => {
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let refreshInterval: number | undefined;
  let visibilityHandler: (() => void) | undefined;

  onMount(async () => {
    try {
      // Create texture loader for initial asset loading
      const textureLoader = new TextureLoader();

      // First, fetch the index of available dates
      const dateIndex = await fetchDateIndex();

      // Set the available dates in app state
      setAppState('availableDates', dateIndex.dates);

      // Available time-series regions (Trends tab). Older index.json files
      // omit this field, so default to ['global'] for compatibility.
      const regionsList = dateIndex.timeseries?.regions?.length
        ? dateIndex.timeseries.regions
        : ['global'];
      setAppState('availableRegions', regionsList);
      // If the persisted region is no longer offered (e.g. removed from S3),
      // fall back to 'global' or whatever's first.
      if (!regionsList.includes(appState.region)) {
        setAppState('region', regionsList.includes('global') ? 'global' : regionsList[0]);
      }

      // Available sources, filtered through KNOWN_SOURCES so an unknown source
      // ID from index.json doesn't get persisted as a selection we can't render.
      const indexSources = (dateIndex.timeseries?.sources ?? []).filter(
        (s): s is SourceId => (KNOWN_SOURCES as string[]).includes(s),
      );
      const sourcesList: SourceId[] = indexSources.length > 0 ? indexSources : ['oisst'];
      setAppState('availableSources', sourcesList);

      // Per-source dated-texture sets. Falls back to the union (dateIndex.dates)
      // for sources without an explicit entry — covers older index.json shapes.
      for (const src of KNOWN_SOURCES) {
        const meta = dateIndex.sources?.[src];
        setAppState('sourceDates', src, meta?.dates ?? dateIndex.dates);
      }

      // Reconcile persisted source against what's actually available.
      if (!sourcesList.includes(appState.source)) {
        setAppState('source', sourcesList.includes('oisst') ? 'oisst' : sourcesList[0]);
      }
      // Reconcile persisted dataset against the current source.
      if (!isValidDataset(appState.source, appState.dataset)) {
        setAppState('dataset', defaultDatasetFor(appState.source));
      }

      // Pick an initial date: the chosen source's latest date if known,
      // otherwise the union latest. This matters when the chosen source
      // lags behind OISST (ERA5's ~5-day reanalysis latency).
      const sourceMeta = dateIndex.sources?.[appState.source];
      const initialDate: string = sourceMeta?.latest ?? dateIndex.latest;
      const initialIndex = dateIndex.dates.indexOf(initialDate);
      setAppState(
        'currentDateIndex',
        initialIndex >= 0 ? initialIndex : Math.max(0, dateIndex.dates.length - 1),
      );

      // Fetch both of the current source's datasets so toggling between them
      // is instant. GlobeScene takes over after this for date-driven loads.
      // If the chosen source can't be fetched (e.g. stale localStorage points
      // at a (source, date) combination that doesn't exist on S3), fall back
      // to OISST so the user always sees *something*.
      let source = appState.source;
      let datasets = DATASETS_BY_SOURCE[source];
      let fetchDate = initialDate;
      let slotResults;
      try {
        slotResults = await Promise.all(
          datasets.map((ds) => fetchDatasetAssets(fetchDate, source, ds, textureLoader)),
        );
      } catch (e) {
        console.warn(
          `Initial fetch failed for ${source}@${fetchDate}; falling back to oisst:`, e,
        );
        source = 'oisst';
        datasets = DATASETS_BY_SOURCE[source];
        fetchDate = dateIndex.latest;
        const fallbackIdx = dateIndex.dates.indexOf(fetchDate);
        setAppState('source', source);
        setAppState('currentDateIndex', fallbackIdx >= 0 ? fallbackIdx : 0);
        if (!isValidDataset(source, appState.dataset)) {
          setAppState('dataset', defaultDatasetFor(source));
        }
        slotResults = await Promise.all(
          datasets.map((ds) => fetchDatasetAssets(fetchDate, source, ds, textureLoader)),
        );
      }
      for (let i = 0; i < datasets.length; i++) {
        const ds = datasets[i];
        setAppState('assets', ds, {
          texture: slotResults[i].texture,
          metadata: slotResults[i].metadata,
          source,
        });
      }

      // Note: After initial load, GlobeScene will handle on-demand loading
      // of only the current dataset to save memory
      setAppState('isLoading', false);
      setIsLoading(false);

      // Hide loading spinner
      const loadingEl = document.querySelector('.loading');
      if (loadingEl) {
        loadingEl.setAttribute('hidden', 'true');
      }

      // Function to refresh the date index
      const refreshIndex = async () => {
        try {
          console.log('Refreshing date index...');
          const newDateIndex = await fetchDateIndex();

          // Only update if we have new dates
          if (newDateIndex.dates.length > appState.availableDates.length) {
            console.log(`Found ${newDateIndex.dates.length - appState.availableDates.length} new date(s)`);
            setAppState('availableDates', newDateIndex.dates);

            // If we're at the end of the list, move to the new latest
            if (appState.currentDateIndex === appState.availableDates.length - 1) {
              setAppState('currentDateIndex', newDateIndex.dates.length - 1);
            }
          }
        } catch (err) {
          console.error('Failed to refresh date index:', err);
          // Don't show error to user, just log it
        }
      };

      // Set up periodic index refresh (every hour)
      refreshInterval = window.setInterval(refreshIndex, 3600000); // 1 hour in milliseconds

      // Refresh when tab becomes visible
      visibilityHandler = () => {
        if (!document.hidden) {
          console.log('Tab became visible, refreshing index...');
          void refreshIndex();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);

    } catch (err) {
      console.error('Failed to load assets:', err);
      setError('Failed to load sea surface temperature data. Please refresh the page to try again.');
      setIsLoading(false);
    }
  });

  // Clean up on unmount
  onCleanup(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
  });

  return (
    <Show
      when={!isLoading() && !error()}
      fallback={
        <Show when={error()}>
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.9)',
            padding: '2rem',
            'border-radius': '8px',
            'text-align': 'center',
            'max-width': '400px'
          }}>
            <h3 style={{ color: '#ff6b6b', 'margin-bottom': '1rem' }}>Error Loading Data</h3>
            <p style={{ color: 'white' }}>{error()}</p>
          </div>
        </Show>
      }
    >
      <AppTabs />
      <KeyboardControls />
    </Show>
  );
};
