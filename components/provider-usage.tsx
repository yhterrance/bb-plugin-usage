import type { ProviderEntry, UsageWindow } from "../server";

const STATUS_COPY: Record<string, string> = {
  not_installed: "Not installed on this machine.",
  unauthenticated: "Not signed in.",
  expired: "Credentials expired — sign in again.",
};

export function formatReset(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return null;

  const deltaMs = at.getTime() - Date.now();
  if (deltaMs <= 0) return "resets now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Ramp toward the destructive token as a window nears its limit, so an
// almost-exhausted quota reads at a glance without parsing the number.
export function barToneClass(usedPercent: number): string {
  if (usedPercent >= 90) return "bg-destructive";
  if (usedPercent >= 75) return "bg-primary";
  return "bg-primary/70";
}

export function UsageBar({
  window: usageWindow,
  compact = false,
}: {
  window: UsageWindow;
  compact?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, usageWindow.usedPercent));
  const reset = formatReset(usageWindow.resetsAt);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={compact ? "text-xs text-foreground" : "text-foreground"}>
          {usageWindow.label}
        </span>
        <span
          className={`tabular-nums text-muted-foreground ${compact ? "text-xs" : ""}`}
        >
          {usageWindow.cost === undefined
            ? `${Math.round(clamped)}%`
            : `${formatUsd(usageWindow.cost.usedUsdCents)} / ${formatUsd(
                usageWindow.cost.limitUsdCents,
              )}`}
        </span>
      </div>
      <div
        className={`w-full overflow-hidden rounded-full bg-muted ${compact ? "h-1.5" : "h-2"}`}
        role="progressbar"
        aria-label={usageWindow.label}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all ${barToneClass(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {reset === null ? null : (
        <p className="text-xs text-muted-foreground">{reset}</p>
      )}
    </div>
  );
}

/** Windows plus the non-ok status copy — shared by the panel and the popover. */
export function ProviderUsageBody({
  provider,
  compact = false,
}: {
  provider: ProviderEntry;
  compact?: boolean;
}) {
  const { usage } = provider;

  if (usage.status === "ok") {
    if (usage.windows.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          No usage windows reported.
        </p>
      );
    }
    return (
      <div className={compact ? "space-y-2.5" : "space-y-4"}>
        {usage.windows.map((usageWindow) => (
          <UsageBar
            key={usageWindow.label}
            window={usageWindow}
            compact={compact}
          />
        ))}
      </div>
    );
  }

  if (usage.status === "error") {
    return <p className="text-xs text-destructive">{usage.message}</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {STATUS_COPY[usage.status] ?? usage.status}
      </p>
      {usage.status === "not_installed" ? null : (
        <p className="text-xs text-muted-foreground">{provider.signInHint}</p>
      )}
    </div>
  );
}
