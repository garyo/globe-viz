import { onMount, createEffect, createMemo } from 'solid-js';
import { appState } from '../stores/appState';
import { getColormapConfig, renderColormap, type ColormapConfig } from '../lib/data/colormap';

export const TopBar = () => {
  let svgRef: SVGSVGElement | undefined;
  let lastConfig: ColormapConfig | null = null;

  const colormapConfig = createMemo(() => {
    if (!appState.assets.sstMetadata.cmap.length) return null;
    return getColormapConfig(
      appState.dataset,
      appState.assets.sstMetadata,
      appState.assets.sstAnomalyMetadata,
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
    if (!config || !svgRef) return;
    if (lastConfig && configEquals(lastConfig, config)) return;
    renderColormap(svgRef, config);
    lastConfig = config;
  });

  const configEquals = (a: ColormapConfig, b: ColormapConfig): boolean =>
    a.title === b.title &&
    a.format === b.format &&
    a.domains.length === b.domains.length &&
    a.domains.every((val, idx) => val === b.domains[idx]) &&
    a.ranges.every((val, idx) => val === b.ranges[idx]);

  const getDate = () => {
    if (appState.dataset === 'Temperature' && appState.assets.sstMetadata.date) {
      return appState.assets.sstMetadata.date;
    }
    if (appState.dataset === 'Temp Anomaly' && appState.assets.sstAnomalyMetadata.date) {
      return appState.assets.sstAnomalyMetadata.date;
    }
    return 'Loading…';
  };

  return (
    <div class="topbar">
      <div class="topbar-info">
        <div id="topdate" class="topbar-date">Date: {getDate()}</div>
      </div>
      <svg ref={svgRef} id="colormap"></svg>
    </div>
  );
};
