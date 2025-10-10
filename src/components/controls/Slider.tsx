interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export const Slider = (props: SliderProps) => {
  return (
    <div class="control-row">
      <label class="control-label">
        <span>{props.label}</span>
        <span class="control-value">{props.value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        class="control-slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
    </div>
  );
};
