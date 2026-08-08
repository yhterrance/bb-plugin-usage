# bb-plugin-usage

AI provider subscription usage limits, surfaced outside of BB's Settings page.

BB shows provider usage under Settings → Usage limits. This plugin puts the
same data where you actually look at it:

- a **Usage** nav panel with its own sidebar entry, and
- a **thread-header control** rendering immediately left of the
  "Open in editor" button, showing peak usage with a popover breakdown.

It also registers `bb usage` so agent threads can read the same numbers.

## Supported providers

BB implements usage for **Codex, Claude Code, and Cursor only**. The host
daemon's `provider.usage` response is a fixed-key object
(`{ codex, claudeCode, cursor }`), not a list — other providers such as
opencode and Pi have no usage source in BB at all, and BB's own settings
panel does not show them either.

Credentials are read locally by the host daemon (Codex `~/.codex/auth.json`,
Claude Code via macOS Keychain, Cursor via Keychain), which then calls each
vendor's API. This plugin never touches credentials itself; it only calls
`bb.sdk.system.usageLimits()`.

## Refresh behavior

Deliberately identical to BB's own usage query — refetch on **mount**,
**window focus**, and **reconnect**, gated by a **30s stale window**, with
**no polling timer**. There is no server-side cache in BB, so every refresh is
a live vendor API call with a 15s daemon-side timeout; a timer would spend
requests on a panel nobody is reading.

`lib/usage-store.ts` shares one cache between the nav panel and the header
control, so mounting both does not double the API calls.

## Install

```sh
bb plugin install git:https://github.com/yhterrance/bb-plugin-usage.git@main
```

On a git install BB runs npm and builds both bundles itself, so `dist/` is
intentionally not committed — a committed `dist/` is always replaced by the
bundles BB builds. The target machine needs `git` and `npm` on PATH.

For local development, install the directory in place:

```sh
bb plugin install .
bb plugin dev          # watch: rebuild + reload on save
```

## CLI

```sh
bb usage show
bb usage show --json
bb usage show --machine <hostId>
```

## Compatibility

Managed (`git:`/`npm:`) installs refuse an SDK mismatch, so keep `engines` in
`package.json` honest: `engines.bb` `>=0.35`, `engines.bbPluginSdk` `^0.4.1`.
After a BB upgrade that bumps the plugin SDK major, rebuild and push. The
vendored `components/ui/` sources are pinned to the BB registry tag matching
the BB version they were added under (see `components.json`).

## Layout

| Path                            | Role                                             |
| ------------------------------- | ------------------------------------------------ |
| `server.ts`                     | RPC contract, `bb.sdk.system.usageLimits`, CLI    |
| `app.tsx`                       | `navPanel` + `experimental_threadHeaderAction`    |
| `lib/usage-store.ts`            | Shared cache, BB's stale/refetch semantics        |
| `hooks/use-usage.ts`            | React binding: mount/focus/reconnect listeners    |
| `components/provider-usage.tsx` | Bars and status copy shared by both surfaces      |
| `components/ui/`                | Vendored shadcn source (yours to edit)            |
