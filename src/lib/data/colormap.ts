import * as d3 from 'd3';
import { legendColor } from 'd3-svg-legend';
import { isMobile } from '../helpers/responsiveness-client';
import type { Metadata } from '../../stores/appState';

export interface ColormapConfig {
  domains: number[];
  ranges: string[];
  cells: number[];
  title: string;
  format: string;
}

export function getColormapConfig(
  dataset: 'Temperature' | 'Temp Anomaly',
  sstMetadata: Metadata,
  sstAnomalyMetadata: Metadata
): ColormapConfig {
  if (dataset === 'Temperature') {
    const domains = sstMetadata.cmap.map((x) => x[0]);
    const ranges = sstMetadata.cmap.map((x) => x[1]);
    const cells = [0, 10, 20, 22, 23, 24, 25, 30, 32, 33, 35];
    return {
      domains,
      ranges,
      cells,
      title: 'Temperature, °C',
      format: '.0f',
    };
  } else {
    const domains = sstAnomalyMetadata.cmap.map((x) => x[0]);
    const ranges = sstAnomalyMetadata.cmap.map((x) => x[1]);
    return {
      domains,
      ranges,
      cells: domains,
      title: 'Temperature Anomaly, °C',
      format: '.1f',
    };
  }
}

export function renderColormap(
  svgElement: SVGSVGElement,
  config: ColormapConfig
) {
  const linear = d3.scaleLinear(config.domains, config.ranges);
  const svg = d3.select(svgElement);
  svg.selectAll('*').remove();

  const mobile = isMobile();
  const shapeWidth = mobile ? 20 : 30;
  const translateX = mobile ? 5 : 10;
  const translateY = mobile ? 12 : 20;

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
