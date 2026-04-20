/**
 * Shared storage abstraction used by every stage.
 *
 * Mirrors the minimal `chrome.storage.local`-style surface the rest of
 * the wallet's adapters already speak. Every stage accepts an injected
 * adapter so the orchestration is testable without a live Chrome API.
 */
export interface StageStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * A storage adapter that can also enumerate all keys. The storage-
 * persistence stage uses this during v1→v2 migration; other stages
 * only need the minimal `StageStorageAdapter`.
 */
export interface EnumerableStorageAdapter extends StageStorageAdapter {
  /**
   * Return a snapshot of every key currently in storage. Only used by
   * migration code; the implementation may be synchronous (in-memory)
   * or async (chrome.storage.local.get(null, ...)).
   */
  keys?(): Promise<string[]>;
}

/**
 * Convenience helper — returns `fallback` if the storage lookup returns
 * null or throws. Used when a stage cannot tolerate a missing key but
 * must not break boot on a transient disk error.
 */
export async function getStorageWithFallback<T>(
  storage: StageStorageAdapter,
  key: string,
  parse: (raw: string) => T,
  fallback: T,
): Promise<T> {
  try {
    const raw = await storage.get(key);
    if (raw == null) return fallback;
    return parse(raw);
  } catch {
    return fallback;
  }
}
