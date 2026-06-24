# amplifier-local adapter — integration & design

This document covers how the `amplifier_local` adapter is wired into this
paperclip fork, the engine version it depends on, and how this fork relates to
upstream paperclip. For install-and-run instructions see the
[repository README](../../../README.md). For failure-mode lookups see
[`troubleshooting.md`](./troubleshooting.md).

The adapter is integrated at the same depth as paperclip's built-in
`claude_local` and `codex_local` adapters — same UI, same session lifecycle,
same observability. The only differences are which engine binary the heartbeat
invokes (`amplifier-agent` instead of `claude` / `codex`) and what models are
available.

## How the adapter is integrated

The adapter is part of this fork as real source files, not an overlay or patch. Key paths:

| Path | What |
|---|---|
| `packages/adapters/amplifier-local/` | Adapter workspace package — TS source + 38 vitest tests |
| `ui/src/adapters/amplifier-local/` | React `ConfigFields` + `UIAdapterModule` |
| `server/src/adapters/registry.ts` | Server-side adapter registration |
| `ui/src/adapters/registry.ts` | UI-side adapter registration |
| `cli/src/adapters/registry.ts` | CLI-side adapter registration |
| `{server,ui,cli}/package.json` | Workspace dep `@paperclipai/adapter-amplifier-local` |

To see exactly what this fork adds vs upstream:

```bash
git remote add upstream https://github.com/paperclipai/paperclip 2>/dev/null
git fetch upstream
git diff $(cat UPSTREAM_PIN)..HEAD
```

## Engine version compatibility

| Engine version | Status |
|---|---|
| `< 0.6.0` | **Below minimum — not supported.** The `amplifier_local` adapter depends on engine features that arrived in the `0.6.0` release wave: `--display ndjson` for structured wire events (cost, model, cache metrics on stderr), `--workspace` for per-agent session isolation, and the `models list` aggregate subcommand for dynamic provider discovery. Older versions also still accepted `--provider`/`--model`/`--effort` on `run`, which the adapter no longer emits — running them together produces `No such option '--provider'`. |
| `>= 0.6.0` | **Required.** Includes all of `--display ndjson`, `--workspace`, `models list` (aggregate mode via `listAllModels()`), the unified `~/.amplifier-agent/` storage root, and the `host_config.provider.{module,config}` single-source-of-truth for provider/model selection. Wrapper-ts `0.7.0` (the npm dep) matches this engine. |

Install (or upgrade to) the required version:

```bash
# fresh install — latest release:
curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh | bash
# pin a specific version:
curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh | bash -s -- --tag v0.6.0
# already installed — upgrade in place:
amplifier-agent update
```

## About this fork

This repository is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
maintained by Microsoft, pinned to upstream paperclip at SHA recorded in [`UPSTREAM_PIN`](../../../UPSTREAM_PIN)
and merged forward periodically.

| Topic | Where |
|---|---|
| Original paperclip README | [`PAPERCLIP-README.md`](../../../PAPERCLIP-README.md) |
| Paperclip-itself bugs | File upstream at [paperclipai/paperclip/issues](https://github.com/paperclipai/paperclip/issues) |
| `amplifier-local` adapter bugs | File here |
| Upstream sync procedure + conflict rules | [`UPSTREAM_SYNC.md`](../../../UPSTREAM_SYNC.md) |
| Files this fork modifies or adds | [`KNOWN_DIVERGENCE.md`](../../../KNOWN_DIVERGENCE.md) |
| Attribution and license | [`NOTICE.md`](../../../NOTICE.md) — original Paperclip AI 2025 copyright preserved verbatim in [`LICENSE`](../../../LICENSE) |

The long-term plan is for the `amplifier-local` adapter to graduate upstream into
paperclip's built-in adapter set, at which point this fork becomes a thin shim or is
archived. Until then: monthly upstream syncs.
