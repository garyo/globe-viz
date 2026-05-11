import * as d3 from 'd3';
import { legendColor } from 'd3-svg-legend';
import { isMobile } from '../helpers/responsiveness-client';
import type { Metadata, DatasetId } from '../../stores/appState';

export interface ColormapConfig {
  domains: number[];
  ranges: string[];
  cells: number[];
  title: string;
  format: string;
}

const DATASET_TITLES: Record<DatasetId, string> = {
  sst: 'Temperature, °C',
  anom: 'Temperature Anomaly, °C',
  t2m: '2 m Air Temperature, °C',
};

// Cells (tick positions) per dataset. SST gets denser ticks around the upper
// range where the most ENSO-relevant variation lives; the others use their
// cmap-defined break points directly.
const DATASET_CELLS: Partial<Record<DatasetId, number[]>> = {
  sst: [0, 10, 20, 22, 23, 24, 25, 30, 32, 33, 35],
};

const DATASET_FORMATS: Record<DatasetId, string> = {
  sst: '.0f',
  anom: '.1f',
  t2m: '.0f',
};

/**
 * Build colormap config for the active dataset using its loaded metadata.
 * Returns null when metadata isn't ready yet (no cmap entries).
 */
export function getColormapConfig(
  dataset: DatasetId,
  metadata: Metadata,
): ColormapConfig | null {
  if (!metadata.cmap?.length) return null;
  const domains = metadata.cmap.map((x) => x[0]);
  const ranges = metadata.cmap.map((x) => x[1]);
  return {
    domains,
    ranges,
    cells: DATASET_CELLS[dataset] ?? domains,
    title: DATASET_TITLES[dataset],
    format: DATASET_FORMATS[dataset],
  };
}

export function renderColormap(
  svgElement: SVGSVGElement,
  config: ColormapConfig
) {
  const linear = d3.scaleLinear(config.domains, config.ranges);
  const svg = d3.select(svgElement);
  svg.selectAll('*').remove();

  const mobile = isMobile();
  const height = svgElement.clientHeight;

  // Adjust positioning based on actual SVG height
  const shapeWidth = mobile ? 20 : 30;
  const translateX = mobile ? 5 : 10;

  // Scale translateY proportionally to available height
  let translateY = 20;
  if (height <= 40) {
    translateY = 3;
  } else if (height <= 70) {
    translateY = 5;
  }

  svg
    .append('g')
    .attr('class', 'legendLinear')
    .attr('transform', `translate(${translateX}, ${translateY})`);

  const legendLinear = legendColor()
    .shapeWidth(shapeWidth)
    .cells(config.cells)
    .labelFormat(d3.format(config.format))
    .orient('horizontal')
    .title(config.title)
    .scale(linear);

  svg.select('.legendLinear').call(legendLinear as any);
}
