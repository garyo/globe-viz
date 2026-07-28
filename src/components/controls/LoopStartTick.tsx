import { Show } from 'solid-js';

/**
 * Position along a date slider for a loop-start index, or null when there's
 * nothing to draw — index 0 loops the whole range, which is the default and
 * needs no marker.
 */
export function trackFraction(index: number, length: number): number | null {
  if (index <= 0 || length <= 1) return null;
  return index / (length - 1);
}

interface LoopStartTickProps {
  /** Position along the track, 0..1, or null to hide the marker. */
  fraction: number | null;
  /** Tooltip text, e.g. "Loop restarts at Mar 3, 2025". */
  label: string;
}

/**
 * Marks where date playback wraps back to, drawn over a range input's track.
 *
 * Must be placed inside a `.slider-track` wrapper, which owns the positioning
 * context and declares `--thumb-size`. The CSS insets the tick by half a thumb
 * at each end so it lines up with where the thumb actually centers — a raw
 * `left: N%` drifts by up to half a thumb width at the extremes.
 */
export const LoopStartTick = (props: LoopStartTickProps) => (
  <Show when={props.fraction !== null}>
    <div
      class="loop-start-tick"
      style={{ '--tick-pct': String(props.fraction) }}
      title={props.label}
      aria-hidden="true"
    />
  </Show>
);
