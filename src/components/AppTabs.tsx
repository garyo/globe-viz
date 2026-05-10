import { Show, Suspense, createEffect, lazy } from 'solid-js';
import { appState } from '../stores/appState';
import { GlobeScene } from './GlobeScene';
import { GlobalHeader } from './GlobalHeader';
import { TopBar } from './TopBar';
import { ControlPanel } from './ControlPanel';
import { About } from './About';

// Lazy-load Trends so ECharts (~800KB pre-gzip) only ships when the user
// actually opens the Trends tab. The chunk also carries TrendsGrid,
// MiniChart, and the shared timeseries utilities, none of which the Globe
// tab uses.
const Trends = lazy(() =>
  import('./Trends').then((m) => ({ default: m.Trends }))
);

export const AppTabs = () => {
  // Mirror the active tab onto the body so CSS can hide globe-only chrome
  // while keeping the WebGL scene mounted.
  createEffect(() => {
    document.body.dataset.activeTab = appState.activeTab;
  });

  return (
    <>
      {/* Always mounted to preserve Three.js scene + texture cache across tab switches. */}
      <GlobeScene />

      <div id="content">
        <GlobalHeader />

        <Show when={appState.activeTab === 'globe'}>
          <TopBar />
          <div id="scene-overlay">
            <ControlPanel />
          </div>
        </Show>

        <Show when={appState.activeTab === 'trends'}>
          <Suspense fallback={<div class="trends-loading">Loading charts…</div>}>
            <Trends />
          </Suspense>
        </Show>

        <Show when={appState.activeTab === 'about'}>
          <About />
        </Show>
      </div>
    </>
  );
};
