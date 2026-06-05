# amplifier-app-paperclip

Setting up [paperclip](https://github.com/paperclipai/paperclip) with the **`amplifier_local`** adapter,
which lets paperclip agents run on the [Amplifier engine](https://github.com/microsoft/amplifier-agent).

The adapter is integrated at the same depth as paperclip's built-in `claude_local` and
`codex_local` adapters — same UI, same session lifecycle, same observability. The only
differences are which engine binary the heartbeat invokes (`amplifier-agent` instead of
`claude` / `codex`) and what models are available.

## Prerequisites

- Node 18+
- pnpm 9+
- git
- `amplifier-agent` >= 0.5.0 on PATH (>= 0.5.1 recommended for delegation flows):
  ```bash
  uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent
  ```
- An LLM provider API key (typically `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)

## Quick start

```bash
git clone https://github.com/microsoft/amplifier-app-paperclip
cd amplifier-app-paperclip
pnpm install
pnpm dev
```

Open **http://127.0.0.1:3101** — look for `amplifier_local` in the adapter type dropdown
when creating or editing an agent.

## Configure your agent's API key

The Amplifier engine reads the provider API key from the **agent's environment variables**,
not from the host shell. Every agent that uses `amplifier_local` needs its own key
configured in the UI:

1. Create or open an agent that uses `amplifier_local`.
2. In the agent's edit form, find the **Agent Environment Run Variables** section.
3. Add a key-value pair:

   | Adapter model | Required key |
   |---|---|
   | `claude-*` (Anthropic) | `ANTHROPIC_API_KEY` |
   | `gpt-*`, `o3-*`, `o4-*` (OpenAI) | `OPENAI_API_KEY` |
   | `gpt-*` via Azure | `AZURE_OPENAI_API_KEY` (+ `AZURE_OPENAI_ENDPOINT`) |
   | `llama*`, `qwen*`, etc. (Ollama) | `OLLAMA_HOST` (e.g. `http://localhost:11434`) |

   Choose the `plain` value type, or use `secret_ref` if you have a secret store wired.
4. Save the agent. Then click **Test environment** — you should see
   `amplifier_provider_key_present_config` (info, green) in the diagnostics.

If the key is missing, the first heartbeat will fail with `provider_init_failed` or
`provider_not_configured`. Fix it by adding the env var to the same Agent Environment Run
Variables section and re-triggering the heartbeat. The adapter never reads keys from your
shell env (multi-tenant by design).

## Engine version compatibility

| Engine version | Status |
|---|---|
| `< 0.5.0` | **Below minimum** — adapter will fail at runtime with config-layer errors |
| `0.5.0` | Works, but sub-session delegation may auto-deny commands outside the auto-approve list (bundled `hooks-approval` module is on by default) |
| `>= 0.5.1` | **Recommended.** `hooks-approval` is opt-in per its upstream USAGE_GUIDE, so delegation flows work cleanly |

Force-reinstall to a specific version:

```bash
uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1
```

(Substitute `@main` for the latest tip if no release tag exists yet.)

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
| `amplifier_local` doesn't appear in the adapter type dropdown | Build wasn't run or failed | Run `pnpm install` — check for errors in the adapter workspace package at `packages/adapters/amplifier-local/` |
| Agent runs hit `No approval provider registered, auto-denying` in stderr | `amplifier-agent` < 0.5.1 with `hooks-approval` mounted | `uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@main` |
| `provider_init_failed` on the first heartbeat | API key missing from the agent's env vars | Add the right key to **Agent Environment Run Variables** (see above) |
| `amplifier-agent: command not found` when paperclip launches a turn | Not on PATH | `uv tool install git+https://github.com/microsoft/amplifier-agent`; ensure `~/.local/bin` is on `PATH` |
| First heartbeat is slow (~30s) | Engine materializing skills and downloading provider modules into `~/.amplifier/cache/` | One-time cost. Subsequent runs are fast. |
| Wrong model output / token count zeros | Engine version mismatch | Confirm `amplifier-agent --version` reports >= 0.5.0 |

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
