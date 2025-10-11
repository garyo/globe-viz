import { onMount, createEffect, createMemo } from 'solid-js';
import { appState } from '../stores/appState';
import { getColormapConfig, renderColormap, type ColormapConfig } from '../lib/data/colormap';

export const TopBar = () => {
  let svgRef: SVGSVGElement | undefined;
  let lastConfig: ColormapConfig | null = null;

  // Compute colormap config reactively - only changes when dataset or metadata changes
  const colormapConfig = createMemo(() => {
    if (!appState.assets.sstMetadata.cmap.length) return null;

    return getColormapConfig(
      appState.dataset,
      appState.assets.sstMetadata,
      appState.assets.sstAnomalyMetadata
    );
  });

  onMount(() => {
    const config = colormapConfig();
    if (config && svgRef) {
      renderColormap(svgRef, config);
      lastConfig = config;
    }
  });

  createEffect(() => {
    const config = colormapConfig();

    // Skip if no config, no SVG ref, or config hasn't changed
    if (!config || !svgRef) return;

    // Only re-render if config actually changed
    if (lastConfig && configEquals(lastConfig, config)) {
      return;
    }

    renderColormap(svgRef, config);
    lastConfig = config;
  });

  // Check if two configs are equal (same colormap data)
  const configEquals = (a: ColormapConfig, b: ColormapConfig): boolean => {
    return a.title === b.title &&
           a.format === b.format &&
           a.domains.length === b.domains.length &&
           a.domains.every((val, idx) => val === b.domains[idx]) &&
           a.ranges.every((val, idx) => val === b.ranges[idx]);
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
