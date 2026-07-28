import { Show, createMemo, createSignal } from 'solid-js';
import { formatDate } from '../../lib/helpers/dates';

interface AnimationControlsProps {
  isAnimating: boolean;
  animationSpeed: number; // in milliseconds
  hasMultipleDates: boolean;
  loopStartDate: string | null;
  onToggleAnimation: () => void;
  onSpeedChange: (speed: number) => void; // expects milliseconds
  onSetLoopStart: () => void;
  onClearLoopStart: () => void;
}

export const AnimationControls = (props: AnimationControlsProps) => {
  // Convert milliseconds to FPS for initial value
  const fps = createMemo(() => 1000 / props.animationSpeed);

  // Track the slider value to avoid display precision loss from ms conversion
  const [displayFps, setDisplayFps] = createSignal(fps());

  const handleFpsChange = (newFps: number) => {
    setDisplayFps(newFps);
    // Convert FPS back to milliseconds
    const ms = Math.round(1000 / newFps);
    props.onSpeedChange(ms);
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
          <span>Speed: {displayFps().toFixed(1)} fps</span>
          <input
            type="range"
            class="control-slider"
            min={1}
            max={30}
            step={0.5}
            value={displayFps()}
            onInput={(e) => handleFpsChange(parseFloat(e.currentTarget.value))}
            style={{ flex: '1' }}
          />
        </label>
      </div>

      <div class="control-row loop-start-controls">
        <span class="control-label-text">
          ⟲ Loop from:{' '}
          <span class="control-value" classList={{ active: !!props.loopStartDate }}>
            {props.loopStartDate ? formatDate(props.loopStartDate) : 'first date'}
          </span>
        </span>
        <div class="loop-start-buttons">
          <button
            class="control-button"
            onClick={props.onSetLoopStart}
            title="Replay from the current date instead of the beginning (L)"
          >
            Set to current
          </button>
          <button
            class="control-button icon"
            onClick={props.onClearLoopStart}
            disabled={!props.loopStartDate}
            title="Clear the loop start"
            aria-label="Clear the loop start"
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  );
};
