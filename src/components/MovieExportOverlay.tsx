import type { MovieExportProgress } from '../lib/export/movieExport';

interface MovieExportOverlayProps {
  progress: MovieExportProgress;
  onCancel: () => void;
}

/**
 * Full-viewport progress overlay shown while a movie export runs. The
 * backdrop swallows pointer events, which also keeps the camera framing
 * fixed for the duration of the export.
 */
export const MovieExportOverlay = (props: MovieExportOverlayProps) => (
  <div class="movie-export-backdrop">
    <div class="movie-export-card">
      <h3>Exporting movie</h3>
      <p>
        {props.progress.phase === 'finalizing'
          ? 'Finalizing…'
          : `Frame ${props.progress.frame} / ${props.progress.total}`}
      </p>
      <progress max={props.progress.total} value={props.progress.frame} />
      <button class="control-button" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  </div>
);
