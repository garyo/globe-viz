interface QuickDateSliderProps {
  dates: string[];
  currentIndex: number;
  isAnimating: boolean;
  onDateChange: (index: number) => void;
  onToggleAnimation: () => void;
  onStopAnimation?: () => void;
  disabled?: boolean;
  visible: boolean;
}

export const QuickDateSlider = (props: QuickDateSliderProps) => {
  return (
    <div
      class="quick-date-slider"
      classList={{ visible: props.visible }}
    >
      <button
        class="quick-play-button"
        onClick={props.onToggleAnimation}
        disabled={props.disabled || props.dates.length <= 1}
        title={props.isAnimating ? 'Pause animation' : 'Play animation'}
      >
        {props.isAnimating ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        class="quick-slider"
        min={0}
        max={props.dates.length - 1}
        step={1}
        value={props.currentIndex}
        disabled={props.disabled || props.dates.length <= 1}
        onMouseDown={() => props.onStopAnimation?.()}
        onTouchStart={() => props.onStopAnimation?.()}
        onInput={(e) => props.onDateChange(parseInt(e.currentTarget.value))}
      />
    </div>
  );
};
