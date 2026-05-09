import { Show, createEffect } from 'solid-js';
import { appState } from '../stores/appState';
import { GlobeScene } from './GlobeScene';
import { GlobalHeader } from './GlobalHeader';
import { TopBar } from './TopBar';
import { ControlPanel } from './ControlPanel';
import { Trends } from './Trends';
import { About } from './About';

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
          <Trends />
        </Show>

        <Show when={appState.activeTab === 'about'}>
          <About />
        </Show>
      </div>
    </>
  );
};
