# Daily Global Sea Surface Temperature Visualization

Visualization of daily sea surface temperatures across the globe, and sea surface temperature anomaly (above or below the mean for that day)

- [Data Source](https://github.com/garyo/sea-surface-temperature)

## Tech Stack

- **Astro** - Modern web framework with partial hydration
- **Solid.js** - Fine-grained reactive UI framework
- **Three.js** - 3D globe rendering
- **TypeScript** - Type safety
- **D3.js** - Colormap legends

## Project Structure

```
src/
├── pages/
│   └── index.astro          # Main page
├── components/
│   ├── TopBar.tsx           # Header with title, date, colormap
│   ├── GlobeScene.tsx       # Three.js 3D globe component
│   ├── ControlPanel.tsx     # Settings panel
│   ├── AppLoader.tsx        # Data loading wrapper
│   └── controls/            # Reusable UI components
│       ├── Slider.tsx
│       ├── Select.tsx
│       ├── ColorPicker.tsx
│       └── Toggle.tsx
├── lib/
│   ├── scene/               # Three.js scene setup
│   │   ├── setup.ts         # Renderer, lights, helpers
│   │   ├── globe.ts         # Globe mesh and materials
│   │   └── camera.ts        # Camera and controls
│   ├── data/
│   │   ├── assets.ts        # S3 data fetching
│   │   └── colormap.ts      # D3 colormap rendering
│   └── helpers/
│       ├── responsiveness.ts
│       ├── fullscreen.ts
│       └── animations.ts
├── stores/
│   └── appState.ts          # Solid.js global state
└── styles/
    └── global.css
```

## Features

- **Reactive UI** - Solid.js provides fine-grained reactivity for instant updates
- **Custom Controls** - Modern, accessible control panel replacing lil-gui
- **Responsive Design** - Mobile-friendly with touch controls
- **State Management** - Centralized Solid.js store with localStorage persistence
- **Modular Architecture** - Clean separation of concerns for easy maintenance
- **Type Safety** - Full TypeScript support throughout

## Development

Installation

```bash
bun i
```

Run dev mode

```bash
bun run dev
```

Open http://localhost:4321 in your browser

Build

```bash
bun run build
```

Preview production build

```bash
bun run preview
```

## Regenerating the Open Graph Image

To rebuild the social-share asset (`public/og-image-20251011.jpg`), run:

```bash
magick public/og-src.png -resize '1200x630^' -gravity center -extent 1200x630 -modulate 110,90,100 -gamma 0.9 \
  \( -size 1200x630 gradient:'#0b122060-#13254b60' \) -gravity center -compose multiply -composite \
  \( -size 1200x420 gradient:'#0b1220d0-#0b122000' \) -gravity north -compose over -composite \
  -font 'Helvetica-Bold' -pointsize 72 -fill '#38bdf8' -gravity north -annotate +0+120 'Global Sea Surface Temperature' \
  -font 'Helvetica' -pointsize 36 -fill '#f8fafc' -interline-spacing 10 -gravity center -annotate +0+80 "Interactive 3D globe using NASA OISST data\nExplore daily trends and anomaly patterns." \
  public/og-image-20251011.jpg
```

Copy the current screenshot to `public/og-src.png` before running the command. Ensure ImageMagick and the `Helvetica` font are available on your system.

## Adding New Controls

To add a new control (e.g., a slider):

1. Add the state to `src/stores/appState.ts`
2. Create or use an existing control component from `src/components/controls/`
3. Add the control to `src/components/ControlPanel.tsx`
4. React to state changes in `src/components/GlobeScene.tsx` using `createEffect`

Example:

```typescript
// In appState.ts
export interface AppState {
  myNewSetting: number;
}

// In ControlPanel.tsx
<Slider
  label="My Setting"
  value={appState.myNewSetting}
  min={0}
  max={10}
  step={0.1}
  onChange={(value) => {
    setAppState('myNewSetting', value);
    saveState();
  }}
/>

// In GlobeScene.tsx
createEffect(() => {
  // React to myNewSetting changes
  console.log('Setting changed:', appState.myNewSetting);
});
```
