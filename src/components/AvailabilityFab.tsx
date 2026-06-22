import { For, Show, createSignal } from 'solid-js';
import {
  appState,
  setAppState,
  applyView,
  anomalyOf,
  variableOf,
  effectiveStatistic,
  datasetFor,
  hasTextureData,
  sourceHasVariable,
  statisticsForSourceVariable,
  statisticsForVariable,
  SOURCE_LABELS,
  type SourceId,
  type StatisticId,
} from '../stores/appState';

// Provenance/latency one-liners — shown as a tooltip on each source name (kept
// out of the row to keep the panel compact).
const SOURCE_NOTES: Record<SourceId, string> = {
  oisst: 'Satellite SST · ~2-day lag',
  era5: 'Reanalysis · ~6-day lag · 1940–now',
  gfs: 'Forecast · near-real-time · short record',
};

const STAT_SHORT: Record<StatisticId, string> = { mean: 'Mean', max: 'Max', min: 'Min' };

/**
 * Floating "Availability" button + compact, stay-open matrix that doubles as
 * the primary data switcher: sources (rows) × what they offer (Sea,
 * Air·Mean/Max/Min), with an Anomaly checkbox. Filled cells are clickable;
 * empty cells (with a hover reason) are the "why this source can't show that".
 * Selecting a cell keeps the panel open. Hidden on the About tab.
 */
export const AvailabilityFab = () => {
  // Open-state lives in the store so the header's current-view chip can open
  // the same panel this FAB toggles.
  const open = () => appState.datasetsPanelOpen;
  const setOpen = (v: boolean) => setAppState('datasetsPanelOpen', v);
  // Which source's provenance note is popped open (click-to-explain — the help
  // cursor invites a click, and hover tooltips don't exist on touch).
  const [noteFor, setNoteFor] = createSignal<SourceId | null>(null);

  const airStats = () => statisticsForVariable('t2m');
  const curVar = () => variableOf(appState.dataset);
  const curStat = () => effectiveStatistic(appState.source, appState.dataset) ?? 'mean';
  const curAnom = () => anomalyOf(appState.dataset);

  const isCurrent = (source: SourceId, kind: 'sst' | StatisticId): boolean => {
    if (source !== appState.source) return false;
    if (kind === 'sst') return curVar() === 'sst';
    return curVar() === 't2m' && effectiveStatistic(source, appState.dataset) === kind;
  };

  // The dataset a cell maps to in the *current* Actual/Anomaly mode.
  const cellDataset = (source: SourceId, kind: 'sst' | StatisticId) =>
    kind === 'sst'
      ? datasetFor(source, 'sst', curAnom())
      : datasetFor(source, 't2m', curAnom(), kind);

  // A cell is selectable only if its dataset exists *and* has textures — so in
  // Anomaly mode, cells whose anomaly isn't built yet (GFS max/min) grey out.
  const cellAvailable = (source: SourceId, kind: 'sst' | StatisticId): boolean => {
    const ds = cellDataset(source, kind);
    return ds !== null && hasTextureData(source, ds);
  };

  // Why a greyed cell is greyed — structural gap vs. anomaly-not-built-yet.
  const cellReason = (source: SourceId, kind: 'sst' | StatisticId): string => {
    const variable = kind === 'sst' ? 'sst' : 't2m';
    if (!sourceHasVariable(source, variable)) {
      return `${SOURCE_LABELS[source].short} has no ${variable === 'sst' ? 'sea-surface' : 'air'} temp`;
    }
    if (kind !== 'sst' && !statisticsForSourceVariable(source, 't2m').includes(kind)) {
      return `${SOURCE_LABELS[source].short} air temp is daily-mean only`;
    }
    return curAnom()
      ? `No anomaly yet for ${SOURCE_LABELS[source].short} ${kind === 'sst' ? 'sea temp' : 'daily ' + kind}`
      : `Not available for ${SOURCE_LABELS[source].short}`;
  };

  // Anomaly checkbox is offered only when an anomaly exists for the current
  // selection (else it stays on Actual).
  const anomAvailable = () => {
    const ds = datasetFor(appState.source, curVar(), true, curStat());
    return ds !== null && hasTextureData(appState.source, ds);
  };

  return (
    <Show when={appState.activeTab !== 'about' && appState.availableSources.length > 1}>
      <button
        type="button"
        class="availability-fab"
        classList={{ active: open() }}
        aria-expanded={open()}
        aria-label="Datasets"
        onClick={() => {
          const next = !open();
          setOpen(next);
          if (!next) setNoteFor(null);
        }}
        title="Choose a dataset"
      >
        <span class="fab-icon" aria-hidden="true">▦</span>
        <span class="fab-label">Datasets</span>
      </button>

      <div
        class="availability-panel"
        classList={{ open: open() }}
        role="dialog"
        aria-label="Datasets"
        aria-hidden={!open()}
      >
        <div class="cap-head">
          <span>Datasets</span>
          <button class="cap-close" onClick={() => { setOpen(false); setNoteFor(null); }} aria-label="Close">×</button>
        </div>

        <table class="cap-table">
          <thead>
            <tr>
              <th class="cap-corner" />
              <th class="cap-var" rowspan={2}>Sea</th>
              <th class="cap-var" colspan={airStats().length}>Air Temp</th>
            </tr>
            <tr>
              <th class="cap-corner" />
              <For each={airStats()}>{(stat) => <th class="cap-stat">{STAT_SHORT[stat]}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={appState.availableSources}>
              {(s) => (
                <tr>
                  <th class="cap-src" scope="row">
                    <button
                      type="button"
                      class="cap-src-btn"
                      title={SOURCE_NOTES[s]}
                      aria-label={`${SOURCE_LABELS[s].full}: ${SOURCE_NOTES[s]}`}
                      onClick={() => setNoteFor((v) => (v === s ? null : s))}
                    >
                      {SOURCE_LABELS[s].short}
                    </button>
                    <Show when={noteFor() === s}>
                      <span class="cap-src-pop" role="tooltip">{SOURCE_NOTES[s]}</span>
                    </Show>
                  </th>

                  {/* Sea column */}
                  <td>
                    <Show
                      when={cellAvailable(s, 'sst')}
                      fallback={<span class="cap-x" title={cellReason(s, 'sst')}>·</span>}
                    >
                      <button
                        class="cap-dot"
                        classList={{ current: isCurrent(s, 'sst') }}
                        onClick={() => applyView(s, 'sst', curAnom())}
                        title={`${SOURCE_LABELS[s].full} — sea-surface temp${curAnom() ? ' anomaly' : ''}`}
                        aria-label={`${SOURCE_LABELS[s].short} sea-surface temp`}
                      />
                    </Show>
                  </td>

                  {/* Air Temp columns, one per statistic */}
                  <For each={airStats()}>
                    {(stat) => (
                      <td>
                        <Show
                          when={cellAvailable(s, stat)}
                          fallback={<span class="cap-x" title={cellReason(s, stat)}>·</span>}
                        >
                          <button
                            class="cap-dot"
                            classList={{ current: isCurrent(s, stat) }}
                            onClick={() => applyView(s, 't2m', curAnom(), stat)}
                            title={`${SOURCE_LABELS[s].full} — daily ${stat} air temp${curAnom() ? ' anomaly' : ''}`}
                            aria-label={`${SOURCE_LABELS[s].short} daily ${stat} air temp`}
                          />
                        </Show>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <label
          class="cap-anom"
          classList={{ disabled: !anomAvailable() }}
          title={anomAvailable() ? 'Difference vs. 1971–2000 climatology' : 'Anomaly not available for this selection'}
        >
          <input
            type="checkbox"
            checked={curAnom()}
            disabled={!anomAvailable()}
            onChange={(e) => applyView(appState.source, curVar(), e.currentTarget.checked, curStat())}
          />
          Anomaly
        </label>

        <Show when={appState.activeTab === 'trends'}>
          <p class="cap-foot cap-foot-warn">GFS: latest data, short record — use ERA5 for long trends.</p>
        </Show>
      </div>
    </Show>
  );
};
