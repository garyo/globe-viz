/**
 * Export one animation cycle as an H.264 MP4 via WebCodecs + mediabunny,
 * frame by frame: fetch each date's texture, render it offscreen through the
 * FrameComposer, and push the composite into the encoder at exact timestamps
 * — no realtime capture, so network stalls never drop or stretch frames.
 *
 * This module (and mediabunny) is only ever loaded via dynamic import() from
 * ControlPanel, keeping it out of the main bundle.
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { fetchDatasetAssets, type DatasetAssets } from '../data/assets';
import { getColormapConfig } from '../data/colormap';
import { updateGlobeTexture } from '../scene/globe';
import {
  SOURCE_LABELS,
  appState,
  getCurrentDate,
  type DatasetId,
  type SourceId,
} from '../../stores/appState';
import type { MovieExportContext } from './exportContext';
import { createFrameComposer } from './frameComposer';
import { createQrCanvas } from './overlay';

export interface MovieExportOptions {
  /** Frames per second; fractional is fine (7.5 from a 133 ms frame time). */
  fps: number;
  /** The cycle's dates in order, snapshotted when the export starts. */
  dates: string[];
  source: SourceId;
  dataset: DatasetId;
  /** Extra hold on the final frame, matching playback's end-of-cycle pause. */
  holdLastMs: number;
  /** Share link to this exact view, burned in as a QR code. */
  shareUrl: string;
}

export interface MovieExportProgress {
  frame: number;
  total: number;
  phase: 'encoding' | 'finalizing';
}

export interface MovieExportHandle {
  /** Resolves with the finished MP4; rejects with MovieExportCancelled on cancel. */
  done: Promise<{ blob: Blob; filename: string }>;
  cancel(): void;
}

export class MovieExportCancelled extends Error {
  constructor() {
    super('Movie export cancelled');
    this.name = 'MovieExportCancelled';
  }
}

const WIDTH = 1920;
const HEIGHT = 1080;
// How many dates to fetch ahead of the encoder, so network/decode overlaps
// encoding without racing far ahead of it.
const PREFETCH_AHEAD = 4;

/** Explicit bitrate: every frame is a full texture change, so be generous —
 * ~0.15 bits/pixel/frame (1080p @ 10 fps ≈ 3.1 Mbps), bounded to sane ends. */
function computeBitrate(width: number, height: number, fps: number): number {
  const raw = Math.round(0.15 * width * height * fps);
  return Math.min(Math.max(raw, 2_500_000), 16_000_000);
}

export function startMovieExport(
  ctx: MovieExportContext,
  opts: MovieExportOptions,
  onProgress: (p: MovieExportProgress) => void,
): MovieExportHandle {
  let cancelled = false;

  const run = async (): Promise<{ blob: Blob; filename: string }> => {
    const { dates, source, dataset, fps } = opts;
    const frameDur = 1 / fps;

    // Prefetch pipeline. Stored promises get a detached no-op catch so a
    // cancelled export doesn't leave unhandled rejections; consumers awaiting
    // the same promise still see the error.
    const pending = new Map<string, Promise<DatasetAssets>>();
    const prefetchFrom = (i: number) => {
      for (let j = i; j < Math.min(i + PREFETCH_AHEAD, dates.length); j++) {
        const d = dates[j];
        if (ctx.textureCache.has(d, source, dataset) || pending.has(d)) continue;
        const p = fetchDatasetAssets(d, source, dataset, ctx.textureLoader).then(
          (assets) => {
            ctx.textureCache.set(d, source, dataset, assets);
            return assets;
          },
        );
        p.catch(() => {});
        pending.set(d, p);
      }
    };
    const getAssets = (d: string): Promise<DatasetAssets> => {
      const cached = ctx.textureCache.get(d, source, dataset);
      if (cached) return Promise.resolve(cached);
      return pending.get(d) ?? fetchDatasetAssets(d, source, dataset, ctx.textureLoader);
    };

    // The legend comes from the first frame's metadata (the colormap is
    // constant across a dataset's dates).
    prefetchFrom(0);
    const first = await getAssets(dates[0]);

    const sourceName = SOURCE_LABELS[source].full;
    const composer = createFrameComposer(ctx, WIDTH, HEIGHT, {
      sourceName,
      legend: getColormapConfig(dataset, first.metadata),
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      credit:
        `Created with globe-viz.oberbrunner.com, ` +
        `© ${new Date().getFullYear()} Gary Oberbrunner. ` +
        `Data from ${sourceName}.`,
      qrCanvas: createQrCanvas(opts.shareUrl, 120),
    });

    let output: Output | undefined;
    try {
      const codec = await getFirstEncodableVideoCodec(['avc'], {
        width: WIDTH,
        height: HEIGHT,
      });
      if (!codec) throw new Error('This browser cannot encode H.264 video');

      const target = new BufferTarget();
      output = new Output({
        // moov before mdat, so the file streams/scrubs immediately.
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
      });
      const videoSource = new CanvasSource(composer.canvas, {
        codec: 'avc',
        quality: new Quality({ bitrate: computeBitrate(WIDTH, HEIGHT, fps) }),
        keyFrameInterval: 2,
      });
      output.addVideoTrack(videoSource, { frameRate: fps });
      await output.start();

      for (let i = 0; i < dates.length; i++) {
        if (cancelled) throw new MovieExportCancelled();
        prefetchFrom(i + 1);
        const assets = await getAssets(dates[i]);
        onProgress({ frame: i + 1, total: dates.length, phase: 'encoding' });
        composer.renderFrame(
          assets.texture,
          dates[i],
          dates.length > 1 ? i / (dates.length - 1) : 1,
        );
        const isLast = i === dates.length - 1;
        // Awaiting add() applies encoder backpressure.
        await videoSource.add(
          i * frameDur,
          isLast ? frameDur + opts.holdLastMs / 1000 : frameDur,
        );
      }

      onProgress({ frame: dates.length, total: dates.length, phase: 'finalizing' });
      videoSource.close();
      await output.finalize();

      const blob = new Blob([target.buffer!], { type: 'video/mp4' });
      const filename =
        `globe-${source}-${dataset.replace(/_/g, '-')}-` +
        `${dates[0]}_${dates[dates.length - 1]}.mp4`;
      return { blob, filename };
    } catch (err) {
      // Release the encoder/muxer; ignore secondary failures so the original
      // error (or the cancellation) is what propagates.
      try {
        await output?.cancel();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      // Put the globe back on the app's current date. The texture cache only
      // fills on date navigation, so on a fresh session the current date's
      // texture may live only in the appState assets slot — fall back to it.
      const current = getCurrentDate();
      const slot = appState.assets[dataset];
      const restore =
        (current ? ctx.textureCache.get(current, source, dataset)?.texture : undefined)
        ?? (slot?.source === source ? slot.texture : null);
      if (restore) updateGlobeTexture(ctx.globe, restore);
      composer.dispose();
    }
  };

  return {
    done: run(),
    cancel: () => {
      cancelled = true;
    },
  };
}
