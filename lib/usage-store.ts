// Shared usage cache with BB's own refresh semantics.
//
// BB's settings panel registers its usage query with
// `{ refetchOnReconnect: true, refetchOnWindowFocus: true, staleTime: 30_000 }`
// and no refetchInterval — refreshes are event-driven, never on a timer. This
// module reproduces that without pulling in React Query, and shares one cache
// between the nav panel and the thread-header control so two mounted surfaces
// never double-fetch the vendor APIs.
import type { ProviderEntry } from "../server";

export const STALE_TIME_MS = 30_000;

export type UsageResponse = {
  providers: ProviderEntry[];
  fetchedAt: number;
  error: string | null;
};

export type UsageEntry = {
  data: UsageResponse | null;
  isFetching: boolean;
  /** Set when the call itself threw, as opposed to a per-provider error. */
  error: string | null;
};

type RpcCaller = (
  method: "getUsage",
  input: { hostId?: string },
) => Promise<unknown>;

const EMPTY: UsageEntry = { data: null, isFetching: false, error: null };

const entries = new Map<string, UsageEntry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

// useSyncExternalStore compares snapshots by identity, so a cache key must
// return the same object until its entry actually changes.
function keyOf(hostId: string | undefined): string {
  return hostId ?? "@primary";
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setEntry(key: string, next: UsageEntry): void {
  entries.set(key, next);
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEntry(hostId: string | undefined): UsageEntry {
  return entries.get(keyOf(hostId)) ?? EMPTY;
}

export function isStale(hostId: string | undefined): boolean {
  const entry = getEntry(hostId);
  if (entry.data === null) return true;
  return Date.now() - entry.data.fetchedAt >= STALE_TIME_MS;
}

/**
 * Fetch unless a fresh result is already cached. `force` bypasses the stale
 * gate for the explicit Refresh button. Concurrent callers share one request.
 */
export function fetchUsage(
  call: RpcCaller,
  hostId: string | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  const key = keyOf(hostId);
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;
  if (options.force !== true && !isStale(hostId)) return Promise.resolve();

  const current = getEntry(hostId);
  setEntry(key, { ...current, isFetching: true });

  const request = (async () => {
    try {
      const result = (await call(
        "getUsage",
        hostId === undefined ? {} : { hostId },
      )) as UsageResponse;
      setEntry(key, { data: result, isFetching: false, error: result.error });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Keep the last good data on screen; surface the failure alongside it.
      setEntry(key, {
        data: getEntry(hostId).data,
        isFetching: false,
        error: message,
      });
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/** Highest used percent across providers that reported successfully. */
export function peakUsedPercent(data: UsageResponse | null): number | null {
  if (data === null) return null;
  let peak: number | null = null;
  for (const provider of data.providers) {
    if (provider.usage.status !== "ok") continue;
    for (const window of provider.usage.windows) {
      if (peak === null || window.usedPercent > peak) peak = window.usedPercent;
    }
  }
  return peak;
}
