import { Show } from 'solid-js';

interface AnimationControlsProps {
  isAnimating: boolean;
  animationSpeed: number;
  hasMultipleDates: boolean;
  onToggleAnimation: () => void;
  onSpeedChange: (speed: number) => void;
}

const SPEED_OPTIONS = [
  { label: 'Slow', value: 1000 },
  { label: 'Medium', value: 500 },
  { label: 'Fast', value: 200 },
  { label: 'Very Fast', value: 100 },
];

export const AnimationControls = (props: AnimationControlsProps) => {
  const getSpeedLabel = () => {
    const option = SPEED_OPTIONS.find(opt => opt.value === props.animationSpeed);
    return option?.label || 'Medium';
  };

  return (
    <Show when={props.hasMultipleDates}>
      <div class="control-row animation-controls">
        <button
          class="control-button"
          onClick={props.onToggleAnimation}
          title={props.isAnimating ? 'Pause animation' : 'Play animation'}
        >
          {props.isAnimating ? '⏸ Pause' : '▶ Play'}
        </button>

        <label class="control-label inline">
          <span>Speed</span>
          <select
            class="control-select"
            value={props.animationSpeed}
            onChange={(e) => props.onSpeedChange(parseInt(e.currentTarget.value))}
          >
            {SPEED_OPTIONS.map(option => (
              <option value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
    </Show>
  );
};
