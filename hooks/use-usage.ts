import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  fetchUsage,
  getEntry,
  isStale,
  subscribe,
  type UsageEntry,
} from "../lib/usage-store";

export type UseUsageResult = UsageEntry & {
  refresh: () => void;
};

/**
 * Mirrors BB's own usage query: refetch on mount, on window focus, and on
 * reconnect — each gated by a 30s stale window. No polling timer.
 */
export function useUsage(hostId: string | undefined): UseUsageResult {
  const rpc = useRpc<typeof rpcContract>();
  const entry = useSyncExternalStore(
    subscribe,
    () => getEntry(hostId),
    () => getEntry(hostId),
  );

  const call = useCallback(
    (method: "getUsage", input: { hostId?: string }) =>
      rpc.call(method, input) as Promise<unknown>,
    [rpc],
  );

  // Mount.
  useEffect(() => {
    void fetchUsage(call, hostId);
  }, [call, hostId]);

  // Focus + reconnect. React Query's focus manager treats a visibilitychange
  // back to visible as a focus, so both events are handled here.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (!isStale(hostId)) return;
      void fetchUsage(call, hostId);
    };
    const onReconnect = () => {
      void fetchUsage(call, hostId, { force: true });
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onReconnect);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onReconnect);
    };
  }, [call, hostId]);

  const refresh = useCallback(() => {
    void fetchUsage(call, hostId, { force: true });
  }, [call, hostId]);

  return { ...entry, refresh };
}
