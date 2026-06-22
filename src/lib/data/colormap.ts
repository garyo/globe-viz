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
  sst_anom: 'SST Anomaly, °C',
  t2m: '2 m Air Temperature, °C',
  t2m_anom: '2 m Air Temp Anomaly, °C',
  t2m_mean: 'Daily Mean 2 m Air Temp, °C',
  t2m_max: 'Daily Max 2 m Air Temp, °C',
  t2m_min: 'Daily Min 2 m Air Temp, °C',
  t2m_mean_anom: 'Daily Mean 2 m Air Temp Anomaly, °C',
  t2m_max_anom: 'Daily Max 2 m Air Temp Anomaly, °C',
  t2m_min_anom: 'Daily Min 2 m Air Temp Anomaly, °C',
};

// Cells (tick positions) per dataset. Each cmap break point would otherwise
// become its own ~30px swatch, and the #colormap SVG caps at 380px — so
// datasets with many break points need a curated, narrower tick set. SST gets
// denser ticks around the upper ENSO-relevant range; t2m_anom's 15-stop cmap
// is sampled down to the populated ±4 °C band plus a couple of tail markers.
// Datasets not listed use their cmap break points directly.
const DATASET_CELLS: Partial<Record<DatasetId, number[]>> = {
  sst: [0, 10, 20, 22, 23, 24, 25, 30, 32, 33, 35],
  // GFS anomaly maps reuse ERA5's 15-stop t2m_anom cmap, so share its ticks.
  t2m_anom: [-10, -3, -1, 0, 1, 2, 3, 4, 9, 16],
  t2m_mean_anom: [-10, -3, -1, 0, 1, 2, 3, 4, 9, 16],
  t2m_max_anom: [-10, -3, -1, 0, 1, 2, 3, 4, 9, 16],
  t2m_min_anom: [-10, -3, -1, 0, 1, 2, 3, 4, 9, 16],
};

const DATASET_FORMATS: Record<DatasetId, string> = {
  sst: '.0f',
  anom: '.1f',
  sst_anom: '.1f',
  t2m: '.0f',
  t2m_anom: '.0f',
  t2m_mean: '.0f',
  t2m_max: '.0f',
  t2m_min: '.0f',
  t2m_mean_anom: '.0f',
  t2m_max_anom: '.0f',
  t2m_min_anom: '.0f',
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
