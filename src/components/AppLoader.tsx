import { createSignal, onMount, onCleanup, Show, type ParentComponent } from 'solid-js';
import { setAppState, appState } from '../stores/appState';
import { fetchDateIndex, fetchDatasetAssets } from '../lib/data/assets';
import { TextureLoader } from 'three';

export const AppLoader: ParentComponent = (props) => {
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

      // Set current date to the latest (last in the array)
      const latestIndex = dateIndex.dates.length - 1;
      setAppState('currentDateIndex', latestIndex >= 0 ? latestIndex : 0);

      // Fetch assets for the latest date
      // Load both datasets initially to have metadata for colormap
      const latestDate = dateIndex.latest;
      const [tempAssets, anomalyAssets] = await Promise.all([
        fetchDatasetAssets(latestDate, 'Temperature', textureLoader),
        fetchDatasetAssets(latestDate, 'Temp Anomaly', textureLoader),
      ]);

      setAppState('assets', {
        sstTexture: tempAssets.texture,
        sstMetadata: tempAssets.metadata,
        sstAnomalyTexture: anomalyAssets.texture,
        sstAnomalyMetadata: anomalyAssets.metadata,
      });

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
      {props.children}
    </Show>
  );
};
