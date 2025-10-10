interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const Toggle = (props: ToggleProps) => {
  return (
    <div class="control-row">
      <label class="control-label toggle-label">
        <span>{props.label}</span>
        <input
          type="checkbox"
          class="control-checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span class="toggle-slider"></span>
      </label>
    </div>
  );
};
