# amplifier-app-paperclip

Setting up [paperclip](https://github.com/paperclipai/paperclip) with the **`amplifier_local`** adapter,
which lets paperclip agents run on the [Amplifier engine](https://github.com/microsoft/amplifier-agent).

The adapter is integrated at the same depth as paperclip's built-in `claude_local` and
`codex_local` adapters — same UI, same session lifecycle, same observability. The only
differences are which engine binary the heartbeat invokes (`amplifier-agent` instead of
`claude` / `codex`) and what models are available.

## Prerequisites

- A **non-root user** — paperclip uses an embedded PostgreSQL that refuses to run as root. Create or switch to a normal user account before continuing.
- Node 18+ (Node 22 LTS recommended)
- pnpm 9+ (`npm install -g pnpm@latest`)
- git
- `uv` for installing the engine (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- `amplifier-agent` **>= 0.5.1**, installed *as the same user that will run paperclip*. The paperclip server invokes `amplifier-agent` per turn and inherits the user's PATH to find both `amplifier-agent` and `uv`. Installing as a different user (e.g. root) silently breaks heartbeats:
  ```bash
  uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1
  # ensure ~/.local/bin is on PATH; verify:
  amplifier-agent version --json   # → {"version":"0.5.1","protocolVersion":"0.3.0"}
  ```
- An LLM provider API key for the model you'll use (e.g. `ANTHROPIC_API_KEY` for Claude, `OPENAI_API_KEY` for GPT). The key is set **per-agent** in the paperclip UI, not in your host shell.

## Quick start

```bash
git clone https://github.com/microsoft/amplifier-app-paperclip
cd amplifier-app-paperclip
pnpm install

# Optional but recommended: export provider API keys in this shell
# BEFORE starting the server. Every `amplifier_local` agent you create
# later will inherit these automatically (whitelisted vars only —
# see "Configure your agent's API key" below for the full list).
export ANTHROPIC_API_KEY=sk-ant-...     # for claude-* models
export OPENAI_API_KEY=sk-...            # for gpt-* / o3-* / o4-* models
# Add only the keys for providers you actually use.

pnpm paperclipai onboard --yes   # one-time: creates board user + Agent JWT secret, then runs the server
```

`onboard --yes` combines initial setup and `pnpm dev`. For subsequent runs (after the first onboarding) use `pnpm dev` directly — but remember to re-export the keys in that shell, otherwise the server starts without them.

Open **http://127.0.0.1:3100** — look for `amplifier_local` in the adapter type dropdown when creating or editing an agent. (The server binds to `127.0.0.1` only; if you need to reach it from another machine, set up an SSH tunnel or reverse proxy.)

If you skipped the `export` step or want different keys per agent, set them per-agent via the UI instead — see [Configure your agent's API key](#configure-your-agents-api-key) below. Both paths work; per-agent values override the host-shell values on collision.

## Verifying it works

After the dev server reports it's listening, sanity-check from another terminal:

```bash
# 1. Health: status ok, bootstrap ready
curl -s http://127.0.0.1:3100/api/health | jq

# 2. Adapter is loaded
curl -s http://127.0.0.1:3100/api/adapters \
  | jq '.[] | select(.type=="amplifier_local")'
# expect: {"type":"amplifier_local","loaded":true,"disabled":false,"modelsCount":11,…}

# 3. Engine version (per-user, must match the user running paperclip)
amplifier-agent version --json
# expect: {"version":"0.5.1","protocolVersion":"0.3.0"}
```

**Note:** `/api/health` returns `authReady: true` even *before* onboarding has run, so health alone is not a sufficient check. The dev-server console banner shows `Agent JWT: set` once onboarding has completed — that's the authoritative signal. If you see `Agent JWT: missing`, re-run `pnpm paperclipai onboard --yes`.

Once you've configured an agent (see next section) and triggered its first heartbeat, the run log under `~/.paperclip-worktrees/instances/<id>/data/runs/<run-id>/` should contain:
- zero `Skipping symlink that escapes skill directory boundary` lines
- zero `No approval provider registered, auto-denying` lines
- zero `'dict' object has no attribute 'approved'` lines
- zero `Cannot initialize without orchestrator` lines
- one or more `[paperclip] Materialized amplifier-local skill "<name>"` lines on the first run

`GET /api/agents/<agent-id>/runtime-state` should report `lastRunStatus: "succeeded"`.

## Configure your agent's API key

The `amplifier_local` adapter reads provider API keys from two sources, in this precedence:

1. **Per-agent** — set in the agent's edit form (Agent Environment Run Variables). Wins on collision.
2. **Host shell of the paperclip server** — exported in the shell where `pnpm dev` runs. Whitelisted to known provider keys only. Each inherited key emits a `[paperclip] Inherited <KEY> from host environment` line in the run log for provenance.

Pick whichever fits. Host-shell inheritance is the common case for single-user dev. Per-agent is required for multi-tenant deployments where each agent needs distinct credentials.

The whitelist (the only env vars the adapter inherits from the paperclip server's shell):

| Adapter model | Required key |
|---|---|
| `claude-*` (Anthropic) | `ANTHROPIC_API_KEY` |
| `gpt-*`, `o3-*`, `o4-*` (OpenAI) | `OPENAI_API_KEY` |
| `gpt-*` via Azure | `AZURE_OPENAI_API_KEY` (+ `AZURE_OPENAI_ENDPOINT`) |
| `gemini-*` (Gemini) | `GEMINI_API_KEY` |
| `llama*`, `qwen*`, etc. (Ollama) | `OLLAMA_HOST` (e.g. `http://localhost:11434`) |

Any other env vars in the paperclip shell (e.g. `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, `PATH`) are **never** passed through to agents.

### Option A — Host shell (simplest, single-user dev)

```bash
export ANTHROPIC_API_KEY=sk-...
pnpm dev
```

Every `amplifier_local` agent automatically picks up the key. Confirm it landed by checking a run log for `[paperclip] Inherited ANTHROPIC_API_KEY from host environment`.

### Option B — Per-agent (multi-tenant, or when you need distinct keys per agent)

1. Create or open an agent that uses `amplifier_local`.
2. In the agent's edit form, find the **Agent Environment Run Variables** section.
3. Add a key-value pair using the env var from the table above. Choose the `plain` value type, or use `secret_ref` if you have a secret store wired.
4. Save the agent. Then click **Test environment** — you should see `amplifier_provider_key_present_config` (info, green) in the diagnostics.

Per-agent values always override host-shell inheritance. Setting an explicit empty string (e.g. `ANTHROPIC_API_KEY: ""`) is a "no key for this agent" signal that also blocks host-shell inheritance.

If no key is available from either source, the first heartbeat fails with `provider_init_failed` or `provider_not_configured`. Fix by setting the env var via Option A or B and re-triggering the heartbeat.

## Engine version compatibility

| Engine version | Status |
|---|---|
| `< 0.5.1` | **Below minimum — not supported.** Versions before `0.5.0` fail at startup with config-layer errors. `0.5.0` runs but sub-session delegation auto-denies any command outside the auto-approve list because the bundled `hooks-approval` module is mounted by default. |
| `>= 0.5.1` | **Required.** `hooks-approval` is opt-in per its upstream USAGE_GUIDE, so delegation flows work cleanly. |

Force-reinstall the required version:

```bash
uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1
```

## Updating

```bash
git pull
pnpm install   # only if package.json / pnpm-lock changed
pnpm dev
```

When upstream paperclip ships changes, they land here through periodic merges — see
[`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Agent JWT: missing (run pnpm paperclipai onboard)` in dev console, or local-agent runs fail to authenticate | Fresh install — onboarding has not been run. The board user and JWT signing secret don't exist yet. | `pnpm paperclipai onboard --yes` (creates the board user + writes `PAPERCLIP_AGENT_JWT_SECRET` to the instance `.env`, then restarts the server) |
| Heartbeat fails with `Cannot initialize without orchestrator … 'uv' is not installed` | The engine subprocess can't find `uv` on PATH because paperclip is running as a different user than the one that installed `amplifier-agent`/`uv` | Install `amplifier-agent` as the same user that runs paperclip (`uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1`) and confirm `~/.local/bin` is on that user's PATH |
| `Error: You are running this script as root. Postgres does not support running as root` on `pnpm dev` | Embedded PostgreSQL refuses root | Create and switch to a non-root user before continuing |
| `amplifier_local` doesn't appear in the adapter type dropdown | Build wasn't run or failed | Run `pnpm install` — check for errors in the adapter workspace package at `packages/adapters/amplifier-local/` |
| Agent runs hit `No approval provider registered, auto-denying` in stderr | `amplifier-agent` older than 0.5.1 (predates the `hooks-approval` unmount) | `uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1` |
| Run log shows `Skipping symlink that escapes skill directory boundary` | Adapter older than [PR #5](https://github.com/microsoft/amplifier-app-paperclip/pull/5) (was symlinking skills instead of copying them) | `git pull` and `pnpm install` to pick up the materialization fix |
| `provider_init_failed` on the first heartbeat | API key missing from the agent's env vars | Add the right key to **Agent Environment Run Variables** (see above) |
| `amplifier-agent: command not found` when paperclip launches a turn | Not on PATH for the running user | `uv tool install git+https://github.com/microsoft/amplifier-agent`; ensure `~/.local/bin` is on `PATH` |
| First heartbeat is slow (~30s) | Engine materializing skills and downloading provider modules into `~/.amplifier/cache/` | One-time cost. Subsequent runs are fast. |
| Wrong model output / token count zeros | Engine version mismatch | Confirm `amplifier-agent --version` reports >= 0.5.1 |
| Server is up but I can't reach it from another machine | Server binds `127.0.0.1` only by design | Use an SSH tunnel (`ssh -L 3100:127.0.0.1:3100 <host>`) or set up a reverse proxy |

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

## About this fork

This repository is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
maintained by Microsoft, pinned to upstream paperclip at SHA recorded in [`UPSTREAM_PIN`](UPSTREAM_PIN)
and merged forward periodically.

| Topic | Where |
|---|---|
| Original paperclip README | [`PAPERCLIP-README.md`](PAPERCLIP-README.md) |
| Paperclip-itself bugs | File upstream at [paperclipai/paperclip/issues](https://github.com/paperclipai/paperclip/issues) |
| `amplifier-local` adapter bugs | File here |
| Upstream sync procedure + conflict rules | [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md) |
| Files this fork modifies or adds | [`KNOWN_DIVERGENCE.md`](KNOWN_DIVERGENCE.md) |
| Attribution and license | [`NOTICE.md`](NOTICE.md) — original Paperclip AI 2025 copyright preserved verbatim in [`LICENSE`](LICENSE) |

The long-term plan is for the `amplifier-local` adapter to graduate upstream into
paperclip's built-in adapter set, at which point this fork becomes a thin shim or is
archived. Until then: monthly upstream syncs.

## License

MIT. See [`LICENSE`](LICENSE) (original Paperclip AI copyright preserved) and [`NOTICE.md`](NOTICE.md)
(Microsoft additions attribution).
