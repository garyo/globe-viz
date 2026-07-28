import { For, Show } from 'solid-js';
import { formatLatLon } from '../lib/scene/geo';
import { formatDate } from '../lib/helpers/dates';
import type { ReadoutCell, ReadoutRow } from '../lib/data/pointReadout';
import type { PickedPoint } from '../stores/appState';

interface PickPopupProps {
  point: PickedPoint;
  /** Null until the place lookup resolves; stays null where no layer covers the point. */
  place: string | null;
  date: string | undefined;
  rows: ReadoutRow[];
  /** Playback deliberately samples only already-loaded layers — say so. */
  isAnimating: boolean;
  onClose: () => void;
}

/**
 * Two marks, splitting the two reasons a cell is empty:
 *   —  there is a map, but no value at this point (land or sea ice)
 *   ·  there is nothing to sample (not published for this date, not offered by
 *      this source, or not loaded yet)
 * The exact reason rides along in each cell's tooltip.
 *
 * Anomalies are signed quantities — "+1.1" reads very differently from "1.1".
 */
function formatCell(cell: ReadoutCell | null, signed: boolean): string {
  if (!cell) return '·';
  switch (cell.state) {
    case 'pending': return '…';
    case 'masked': return '—';
    case 'unpublished':
    case 'unavailable': return '·';
    case 'value': {
      const value = cell.value!;
      const text = signed && value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
      if (cell.clip === 'low') return `≤${text}`;
      if (cell.clip === 'high') return `≥${text}`;
      return text;
    }
  }
}

function cellTitle(cell: ReadoutCell | null): string | undefined {
  if (!cell) return 'This source does not publish that measurement';
  switch (cell.state) {
    case 'masked': return 'No value here — land or sea ice';
    case 'unpublished': return 'This source has no map for this date';
    case 'unavailable': return 'Not loaded — pause playback to fetch it';
    case 'pending': return 'Loading…';
    case 'value':
      return cell.clip
        ? 'Off the end of the color scale — the true value is beyond this bound'
        : undefined;
  }
}

const Cell = (props: { cell: ReadoutCell | null; signed?: boolean }) => (
  <td
    classList={{ muted: props.cell?.state !== 'value' || !!props.cell?.clip }}
    title={cellTitle(props.cell)}
  >
    <span
      classList={{ swatch: !!props.cell?.color }}
      style={props.cell?.color ? { '--swatch': props.cell.color } : undefined}
    >
      {formatCell(props.cell, !!props.signed)}
    </span>
  </td>
);

export const PickPopup = (props: PickPopupProps) => (
  <div class="pick-popup open" role="dialog" aria-label="Point readout">
    <div class="pick-popup-header">
      <div class="pick-popup-title">
        <Show when={props.place} fallback={<span class="pick-popup-place unknown">Unnamed area</span>}>
          <span class="pick-popup-place">{props.place}</span>
        </Show>
        <span class="pick-popup-coords">{formatLatLon(props.point)}</span>
      </div>
      <button class="pick-popup-close" onClick={props.onClose} aria-label="Close readout">
        ×
      </button>
    </div>

    <Show when={props.date}>
      {(date) => <div class="pick-popup-date">{formatDate(date())}</div>}
    </Show>

    <Show
      when={props.rows.length > 0}
      fallback={<div class="pick-popup-empty">No data published for this date.</div>}
    >
      <table class="pick-popup-table">
        <thead>
          <tr>
            <th />
            <th>Actual</th>
            <th>Anomaly</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <th scope="row">{row.label}</th>
                <Cell cell={row.actual} />
                <Cell cell={row.anomaly} signed />
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>

    <Show when={props.isAnimating}>
      <p class="pick-popup-footnote animating">
        Only the layer on screen updates while playing — pause to read the rest.
      </p>
    </Show>

    <p class="pick-popup-footnote">
      All values °C, read back from the map colors — roughly ±0.1 °C, less
      accurate near coastlines.
      <br />
      <b>—</b> no value here (land or sea ice)
      <br />
      <b>·</b> nothing to sample
    </p>
  </div>
);
