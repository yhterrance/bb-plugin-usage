// bb-plugin-usage — frontend entry.
//
// Two surfaces over one shared cache:
//   * a top-level nav panel (its own sidebar entry + route), and
//   * a thread-header control that renders immediately left of BB's
//     "Open in editor" button.
//
// Both use lib/usage-store, which reproduces BB's own refresh semantics
// (mount + window focus + reconnect, 30s stale gate, no polling timer).
import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { useUsage } from "./hooks/use-usage";
import { peakUsedPercent } from "./lib/usage-store";
import { ProviderUsageBody, barToneClass } from "./components/provider-usage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type HostOption = { id: string; name: string; connected: boolean };

function useHosts(): HostOption[] {
  const rpc = useRpc<typeof rpcContract>();
  const [hosts, setHosts] = useState<HostOption[]>([]);

  useEffect(() => {
    void rpc
      .call("listHosts")
      .then((result) => setHosts((result as { hosts: HostOption[] }).hosts))
      // The picker is optional; without it the primary host still resolves.
      .catch(() => undefined);
  }, [rpc]);

  return hosts;
}

function UsagePanel() {
  const hosts = useHosts();
  const [hostId, setHostId] = useState<string | undefined>(undefined);
  const { data, isFetching, error, refresh } = useUsage(hostId);

  const fetchedLabel =
    data === null ? null : new Date(data.fetchedAt).toLocaleTimeString();

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Your provider subscription usage.
            {fetchedLabel === null ? null : ` Updated ${fetchedLabel}.`}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={refresh}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {hosts.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {hosts.map((host) => (
              <Button
                key={host.id}
                size="sm"
                variant={host.id === hostId ? "default" : "outline"}
                disabled={!host.connected}
                onClick={() => setHostId(host.id)}
              >
                {host.name}
                {host.connected ? "" : " (offline)"}
              </Button>
            ))}
          </div>
        ) : null}

        {error === null ? null : (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        )}

        {data === null && isFetching ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Loading usage…
            </CardContent>
          </Card>
        ) : null}

        {data?.providers.map((provider) => (
          <Card key={provider.key}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-medium text-foreground">
                  {provider.name}
                </h2>
                {provider.usage.status === "ok" &&
                provider.usage.planLabel !== null ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {provider.usage.planLabel}
                  </span>
                ) : null}
              </div>
              {provider.usage.status === "ok" &&
              provider.usage.accountEmail !== null ? (
                <p className="text-xs text-muted-foreground">
                  {provider.usage.accountEmail}
                </p>
              ) : null}
            </CardHeader>
            <CardContent>
              <ProviderUsageBody provider={provider} />
            </CardContent>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">
          BB reports subscription usage for Codex, Claude Code, and Cursor only.
          Other providers do not expose usage limits.
        </p>
      </div>
    </div>
  );
}

// The header row clamps controls to 28px and the host wrapper already applies
// `flex max-h-7 max-w-64 shrink-0 items-center`, so this stays one small
// button and puts the detail in a portalled popover.
function UsageHeaderAction() {
  const { data, isFetching, error, refresh } = useUsage(undefined);
  const peak = peakUsedPercent(data);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen && error !== null) toast.error(error);
  }, [isOpen, error]);

  const label =
    peak === null ? "Provider usage" : `Provider usage — ${Math.round(peak)}%`;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="h-1.5 w-6 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full transition-all ${barToneClass(peak ?? 0)}`}
              style={{ width: `${Math.min(100, Math.max(0, peak ?? 0))}%` }}
            />
          </span>
          <span className="text-xs tabular-nums">
            {peak === null ? "—" : `${Math.round(peak)}%`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            Provider usage
          </span>
          <button
            type="button"
            disabled={isFetching}
            onClick={refresh}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error === null ? null : (
          <p className="text-xs text-destructive">{error}</p>
        )}

        {data === null ? (
          <p className="text-xs text-muted-foreground">Loading usage…</p>
        ) : (
          data.providers.map((provider) => (
            <div key={provider.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {provider.name}
                </span>
                {provider.usage.status === "ok" &&
                provider.usage.planLabel !== null ? (
                  <span className="text-[10px] text-muted-foreground">
                    {provider.usage.planLabel}
                  </span>
                ) : null}
              </div>
              <ProviderUsageBody provider={provider} compact />
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "usage",
    title: "Usage",
    icon: "ChartBar",
    path: "usage",
    component: UsagePanel,
  });

  app.slots.experimental_threadHeaderAction({
    id: "usage",
    title: "Provider usage",
    component: UsageHeaderAction,
  });
});
