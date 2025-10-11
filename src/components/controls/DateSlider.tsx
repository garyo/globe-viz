import { Show } from 'solid-js';

interface DateSliderProps {
  dates: string[];
  currentIndex: number;
  onDateChange: (index: number) => void;
  disabled?: boolean;
}

export const DateSlider = (props: DateSliderProps) => {
  const formatDate = (dateStr: string) => {
    // Format YYYY-MM-DD to a more readable format
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <Show when={props.dates.length > 0}>
      <div class="control-row">
        <label class="control-label">
          <span>Date</span>
          <span class="control-value">
            {formatDate(props.dates[props.currentIndex] || props.dates[0])}
          </span>
        </label>
        <input
          type="range"
          class="control-slider"
          min={0}
          max={props.dates.length - 1}
          step={1}
          value={props.currentIndex}
          disabled={props.disabled || props.dates.length <= 1}
          onInput={(e) => props.onDateChange(parseInt(e.currentTarget.value))}
        />
        <div class="date-range-labels">
          <span class="date-label-start">{formatDate(props.dates[0])}</span>
          <span class="date-label-end">{formatDate(props.dates[props.dates.length - 1])}</span>
        </div>
      </div>
    </Show>
  );
};
