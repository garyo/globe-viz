interface RotationControlsProps {
  autoRotate: boolean;
  rotateSpeed: number;
  onToggleRotate: () => void;
  onSpeedChange: (speed: number) => void;
}

export const RotationControls = (props: RotationControlsProps) => {
  return (
    <div class="control-row rotation-controls">
      <button
        class="control-button"
        onClick={props.onToggleRotate}
        title={props.autoRotate ? 'Stop rotation' : 'Start rotation'}
      >
        {props.autoRotate ? '⏸ Stop' : '🔄 Rotate'}
      </button>

      <label class="control-label inline">
        <span>Rotate Speed: {props.rotateSpeed.toFixed(1)}</span>
        <input
          type="range"
          class="control-slider"
          min={-5}
          max={5}
          step={0.1}
          value={props.rotateSpeed}
          onInput={(e) => props.onSpeedChange(parseFloat(e.currentTarget.value))}
          style={{ flex: '1' }}
        />
      </label>
    </div>
  );
};
