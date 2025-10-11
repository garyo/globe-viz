import type { Assets } from './assets';

/**
 * LRU cache for texture assets to avoid re-fetching from S3
 * Stores up to maxSize entries, evicting least recently used when full
 */
export class TextureCache {
  private cache: Map<string, Assets>;
  private maxSize: number;

  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
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
    // If already exists, delete it first so we can re-add at end
    if (this.cache.has(date)) {
      this.cache.delete(date);
    }

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize) {
      // Map iteration order is insertion order, so first entry is LRU
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
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
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
