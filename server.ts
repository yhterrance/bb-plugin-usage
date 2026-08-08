// bb-plugin-usage — backend entry.
//
// Surfaces the same provider subscription usage that BB shows under
// Settings → Usage limits, but as a top-level nav panel.
//
// The data comes from bb.sdk.system.usageLimits(), which proxies to the host
// daemon's `provider.usage` command. That command reads local provider
// credentials (Codex ~/.codex/auth.json, Claude Code Keychain, Cursor
// Keychain) and calls each vendor's API live — there is no server-side cache,
// so every call is a real network round trip with a 15s daemon-side timeout.
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

// BB only implements usage for these three providers. The daemon response is
// a fixed-key object, not a list, so this is the complete set — opencode and
// Pi have no usage source in BB at all.
const PROVIDER_KEYS = ["codex", "claudeCode", "cursor"] as const;

const usageWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
  cost: z
    .object({
      usedUsdCents: z.number().int(),
      limitUsdCents: z.number().int(),
    })
    .optional(),
});

const providerUsageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    accountEmail: z.string().nullable(),
    planLabel: z.string().nullable(),
    windows: z.array(usageWindowSchema),
  }),
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

// The panel renders a list, so the fixed-key daemon payload is flattened into
// one entry per provider with its display name attached server-side.
const providerEntrySchema = z.object({
  key: z.enum(PROVIDER_KEYS),
  name: z.string(),
  signInHint: z.string(),
  usage: providerUsageSchema,
});

// Exported for the frontend to import type-only — keeps app.tsx from
// re-deriving these shapes out of the rpc call signature.
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type ProviderEntry = z.infer<typeof providerEntrySchema>;

export const rpcContract = defineRpcContract({
  listHosts: {
    input: z.null(),
    output: z.object({
      hosts: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          connected: z.boolean(),
        }),
      ),
    }),
  },
  getUsage: {
    input: z.object({ hostId: z.string().optional() }).strict(),
    output: z.object({
      providers: z.array(providerEntrySchema),
      fetchedAt: z.number().int(),
      error: z.string().nullable(),
    }),
  },
});

const PROVIDER_META: Record<
  (typeof PROVIDER_KEYS)[number],
  { name: string; signInHint: string }
> = {
  codex: {
    name: "Codex",
    signInHint: "Run `codex` to sign in and see your usage.",
  },
  claudeCode: {
    name: "Claude Code",
    signInHint: "Run `claude` to sign in and see your usage.",
  },
  cursor: {
    name: "Cursor",
    signInHint: "Run `cursor-agent login` to sign in and see your usage.",
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  async function fetchUsage(hostId?: string) {
    // A disconnected or unusable host makes the whole call throw rather than
    // returning per-provider errors, so the failure is reported panel-wide.
    try {
      const response = await bb.sdk.system.usageLimits(
        hostId === undefined ? {} : { hostId },
      );
      const providers = PROVIDER_KEYS.map((key) => ({
        key,
        name: PROVIDER_META[key].name,
        signInHint: PROVIDER_META[key].signInHint,
        usage: response[key],
      }));
      return { providers, fetchedAt: Date.now(), error: null };
    } catch (error) {
      bb.log.warn(`usage fetch failed: ${errorMessage(error)}`);
      return { providers: [], fetchedAt: Date.now(), error: errorMessage(error) };
    }
  }

  bb.rpc.register(rpcContract, {
    async listHosts() {
      const hosts = await bb.sdk.hosts.list();
      return {
        hosts: hosts.map((host) => ({
          id: host.id,
          name: host.name,
          connected: host.status === "connected",
        })),
      };
    },
    async getUsage({ hostId }) {
      return fetchUsage(hostId);
    },
  });

  // Agent-facing CLI so a thread can read the same numbers without the UI.
  bb.cli.register({
    name: "usage",
    summary: "Show AI provider subscription usage limits",
    commands: [
      {
        name: "show",
        summary: "Show usage limits for every supported provider",
        usage: "bb usage show [--machine <hostId>] [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const machineIndex = argv.indexOf("--machine");
      const hostId =
        machineIndex === -1 ? undefined : argv[machineIndex + 1];
      if (machineIndex !== -1 && hostId === undefined) {
        return { exitCode: 1, stderr: "--machine requires a host id\n" };
      }

      const result = await fetchUsage(hostId);
      if (json) {
        return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
      }
      if (result.error !== null) {
        return { exitCode: 1, stderr: `${result.error}\n` };
      }

      const lines: string[] = [];
      for (const provider of result.providers) {
        const { usage } = provider;
        if (usage.status !== "ok") {
          lines.push(`${provider.name}: ${usage.status.replace(/_/gu, " ")}`);
          continue;
        }
        const plan = usage.planLabel === null ? "" : ` (${usage.planLabel})`;
        lines.push(`${provider.name}${plan}`);
        for (const window of usage.windows) {
          const resets =
            window.resetsAt === null ? "" : ` — resets ${window.resetsAt}`;
          lines.push(
            `  ${window.label}: ${Math.round(window.usedPercent)}%${resets}`,
          );
        }
      }
      return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
    },
  });

  bb.log.info("usage panel ready");
}
