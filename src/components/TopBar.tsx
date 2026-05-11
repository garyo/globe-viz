import { onMount, createEffect, createMemo } from 'solid-js';
import { appState } from '../stores/appState';
import { getColormapConfig, renderColormap, type ColormapConfig } from '../lib/data/colormap';

export const TopBar = () => {
  let svgRef: SVGSVGElement | undefined;
  let lastConfig: ColormapConfig | null = null;

  const colormapConfig = createMemo(() => {
    const slot = appState.assets[appState.dataset];
    if (!slot?.metadata?.cmap?.length) return null;
    return getColormapConfig(appState.dataset, slot.metadata);
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
    const slot = appState.assets[appState.dataset];
    return slot?.metadata?.date || 'Loading…';
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
