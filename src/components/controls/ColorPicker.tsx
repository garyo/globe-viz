interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export const ColorPicker = (props: ColorPickerProps) => {
  return (
    <div class="control-row">
      <label class="control-label">
        <span>{props.label}</span>
      </label>
      <div class="color-picker-wrapper">
        <input
          type="color"
          class="control-color"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <span class="color-value">{props.value}</span>
      </div>
    </div>
  );
};
