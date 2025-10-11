import { onMount, createEffect } from 'solid-js';
import { appState } from '../stores/appState';
import { getColormapConfig, renderColormap } from '../lib/data/colormap';

export const TopBar = () => {
  let svgRef: SVGSVGElement | undefined;

  onMount(() => {
    updateColormap();
  });

  createEffect(() => {
    // Re-render colormap when dataset changes
    appState.dataset; // Track this value
    updateColormap();
  });

  const updateColormap = () => {
    if (!svgRef || !appState.assets.sstMetadata.cmap.length) return;

    const config = getColormapConfig(
      appState.dataset,
      appState.assets.sstMetadata,
      appState.assets.sstAnomalyMetadata
    );

    renderColormap(svgRef, config);
  };

  const getDate = () => {
    if (appState.dataset === 'Temperature' && appState.assets.sstMetadata.date) {
      return appState.assets.sstMetadata.date;
    } else if (appState.dataset === 'Temp Anomaly' && appState.assets.sstAnomalyMetadata.date) {
      return appState.assets.sstAnomalyMetadata.date;
    }
    return 'Loading...';
  };

  const handleAboutClick = () => {
    document.dispatchEvent(new CustomEvent('open-about-popup'));
  };

  return (
    <div class="topbar">
      <div>
        <div>Global Sea Surface Temperature</div>
        <div id="topdate">Date: {getDate()}</div>
        <div>
          <button
            class="about-button"
            onClick={handleAboutClick}
            title="About this app"
            aria-label="About"
          >
            About
          </button>
        </div>
      </div>
      <svg ref={svgRef} id="colormap"></svg>
    </div>
  );
};
