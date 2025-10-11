import type { Assets } from './assets';

/**
 * LRU cache for texture assets to avoid re-fetching from S3
 * Stores up to maxSize entries, evicting least recently used when full
 * Properly disposes of Three.js textures and Object URLs to prevent memory leaks
 */
export class TextureCache {
  private cache: Map<string, Assets>;
  private maxSize: number;

  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Dispose of textures and clean up Object URLs in an Assets object
   */
  private disposeAssets(assets: Assets): void {
    // Clean up SST texture
    if (assets.sstTexture && assets.sstTexture.userData.objectUrl) {
      URL.revokeObjectURL(assets.sstTexture.userData.objectUrl);
      assets.sstTexture.dispose();
    }
    // Clean up SST anomaly texture
    if (assets.sstAnomalyTexture && assets.sstAnomalyTexture.userData.objectUrl) {
      URL.revokeObjectURL(assets.sstAnomalyTexture.userData.objectUrl);
      assets.sstAnomalyTexture.dispose();
    }
  }

  /**
   * Get assets for a date from cache, or undefined if not cached
   * Marks the entry as recently used (moves to end)
   */
  get(date: string): Assets | undefined {
    const assets = this.cache.get(date);
    if (assets) {
      // Move to end (most recently used)
      this.cache.delete(date);
      this.cache.set(date, assets);
    }
    return assets;
  }

  /**
   * Store assets for a date in the cache
   * Evicts LRU entry if cache is full
   */
  set(date: string, assets: Assets): void {
    // If already exists, dispose old assets first
    if (this.cache.has(date)) {
      const oldAssets = this.cache.get(date);
      if (oldAssets) {
        this.disposeAssets(oldAssets);
      }
      this.cache.delete(date);
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
    this.cache.set(date, assets);
  }

  /**
   * Check if a date is in the cache
   */
  has(date: string): boolean {
    return this.cache.has(date);
  }

  /**
   * Clear all cached entries and dispose of textures
   */
  clear(): void {
    for (const assets of this.cache.values()) {
      this.disposeAssets(assets);
    }
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
