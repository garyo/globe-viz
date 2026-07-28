import { Show } from 'solid-js';
import { formatDate } from '../../lib/helpers/dates';
import { LoopStartTick, trackFraction } from './LoopStartTick';

interface DateSliderProps {
  dates: string[];
  currentIndex: number;
  loopStartIndex: number;
  onDateChange: (index: number) => void;
  onStopAnimation?: () => void;
  disabled?: boolean;
}

export const DateSlider = (props: DateSliderProps) => {
  return (
    <Show when={props.dates.length > 0}>
      <div class="control-row">
        <label class="control-label">
          <span>Date</span>
          <span class="control-value">
            {formatDate(props.dates[props.currentIndex] || props.dates[0])}
          </span>
        </label>
        <div class="slider-track">
          <input
            type="range"
            class="control-slider"
            min={0}
            max={props.dates.length - 1}
            step={1}
            value={props.currentIndex}
            disabled={props.disabled || props.dates.length <= 1}
            onMouseDown={() => props.onStopAnimation?.()}
            onTouchStart={() => props.onStopAnimation?.()}
            onInput={(e) => props.onDateChange(parseInt(e.currentTarget.value))}
          />
          <LoopStartTick
            fraction={trackFraction(props.loopStartIndex, props.dates.length)}
            label={`Playback loops back to ${formatDate(props.dates[props.loopStartIndex] ?? props.dates[0])}`}
          />
        </div>
        <div class="date-range-labels">
          <span class="date-label-start">{formatDate(props.dates[0])}</span>
          <span class="date-label-end">{formatDate(props.dates[props.dates.length - 1])}</span>
        </div>
      </div>
    </Show>
  );
};
