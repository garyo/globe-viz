import { createSignal, onMount, Show, type ParentComponent } from 'solid-js';
import { setAppState } from '../stores/appState';
import { fetchAssets } from '../lib/data/assets';

export const AppLoader: ParentComponent = (props) => {
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const assets = await fetchAssets();
      setAppState('assets', {
        sstTexture: assets.sstTexture,
        sstMetadata: assets.sstMetadata,
        sstAnomalyTexture: assets.sstAnomalyTexture,
        sstAnomalyMetadata: assets.sstAnomalyMetadata,
      });
      setAppState('isLoading', false);
      setIsLoading(false);

      // Hide loading spinner
      const loadingEl = document.querySelector('.loading');
      if (loadingEl) {
        loadingEl.setAttribute('hidden', 'true');
      }
    } catch (err) {
      console.error('Failed to load assets:', err);
      setError('Failed to load sea surface temperature data. Please refresh the page to try again.');
      setIsLoading(false);
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
