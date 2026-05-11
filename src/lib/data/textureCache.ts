import type { DatasetAssets } from './assets';
import type { SourceId, DatasetId } from '../../stores/appState';

/**
 * LRU cache for dataset texture assets to avoid re-fetching from S3.
 * Stores individual dataset textures keyed by (date, source, dataset).
 * Properly disposes of Three.js textures and Object URLs to prevent memory leaks.
 */
export class TextureCache {
  private cache: Map<string, DatasetAssets>;
  private maxSize: number;

  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  private getCacheKey(date: string, source: SourceId, dataset: DatasetId): string {
    return `${date}-${source}-${dataset}`;
  }

  private disposeAssets(assets: DatasetAssets): void {
    if (assets.texture && assets.texture.userData.objectUrl) {
      URL.revokeObjectURL(assets.texture.userData.objectUrl);
      assets.texture.dispose();
    }
  }

  /**
   * Get assets for a (date, source, dataset) from cache, or undefined if not cached.
   * Marks the entry as recently used (moves to end).
   */
  get(date: string, source: SourceId, dataset: DatasetId): DatasetAssets | undefined {
    const key = this.getCacheKey(date, source, dataset);
    const assets = this.cache.get(key);
    if (assets) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, assets);
    }
    return assets;
  }

  /**
   * Store assets for a (date, source, dataset) in the cache.
   * Evicts LRU entry if cache is full.
   */
  set(date: string, source: SourceId, dataset: DatasetId, assets: DatasetAssets): void {
    const key = this.getCacheKey(date, source, dataset);

    // If already exists, dispose old assets first
    if (this.cache.has(key)) {
      const oldAssets = this.cache.get(key);
      if (oldAssets) {
        this.disposeAssets(oldAssets);
      }
      this.cache.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize) {
      // Map iteration order is insertion order, so first entry is LRU
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const evictedAssets = this.cache.get(firstKey);
        if (evictedAssets) {
          this.disposeAssets(evictedAssets);
        }
        this.cache.delete(firstKey);
      }
    }

    // Add new entry (at end, most recently used)
    this.cache.set(key, assets);
  }

  /**
   * Check if a (date, source, dataset) is in the cache.
   */
  has(date: string, source: SourceId, dataset: DatasetId): boolean {
    return this.cache.has(this.getCacheKey(date, source, dataset));
  }

  /**
   * Clear all cached entries and dispose of textures.
   */
  clear(): void {
    for (const assets of this.cache.values()) {
      this.disposeAssets(assets);
    }
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
