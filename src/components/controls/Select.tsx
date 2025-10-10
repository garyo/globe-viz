import { For } from 'solid-js';

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}

export const Select = <T extends string>(props: SelectProps<T>) => {
  return (
    <div class="control-row">
      <label class="control-label">
        <span>{props.label}</span>
      </label>
      <select
        class="control-select"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
      >
        <For each={[...props.options]}>
          {(option) => <option value={option}>{option}</option>}
        </For>
      </select>
    </div>
  );
};
