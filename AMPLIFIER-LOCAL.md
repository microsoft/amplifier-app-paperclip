# amplifier-local adapter

This fork integrates `amplifier-local`, a paperclip adapter that lets agents run on the
[Amplifier engine](https://github.com/microsoft/amplifier-agent) (the `amplifier-agent` Python CLI).

It mirrors the integration depth of paperclip's built-in `claude_local` and `codex_local`
adapters: server registry, UI registry, CLI registry, React `ConfigFields`, custom
`formatStdoutEvent`, `sessionCodec`, and the full set of capability flags.

## Prerequisites

- Node 18+
- pnpm 9+
- git
- `amplifier-agent` >= 0.5.0 on PATH (>= 0.5.1 recommended for reliable delegation flows)
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

Then open **http://127.0.0.1:3101** — look for `amplifier_local` in the adapter type
dropdown when creating or editing an agent.

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
`provider_not_configured` — fix it by adding the env var to the same Agent Environment
Run Variables section and re-triggering the heartbeat. The adapter never reads keys
from your shell env (multi-tenant by design).

## Engine version compatibility

| Engine | Status |
|---|---|
| `< 0.5.0` | **Required minimum** — adapter will fail at runtime with config layer errors. |
| `0.5.0` | Works but uses the bundled `hooks-approval` module by default; sub-session delegation may auto-deny commands outside the auto-approve list. Upgrade if you use delegation. |
| `>= 0.5.1` | Recommended. `hooks-approval` is opt-in (per upstream USAGE_GUIDE), so delegation flows work cleanly. |

Force-reinstall to a specific version:
```bash
uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@v0.5.1
```
(Substitute `@main` for the latest development tip if no release tag exists yet.)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `amplifier_local` doesn't appear in the adapter type dropdown | The fork didn't build cleanly | Run `pnpm install` and check for errors. The adapter package is at `packages/adapters/amplifier-local/`. |
| Dev server starts but agent runs hit `No approval provider registered, auto-denying` | `amplifier-agent` < 0.5.1 with `hooks-approval` mounted | Upgrade: `uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@main` |
| `provider_init_failed` on the first heartbeat | API key missing from the agent's environment variables | Add the right key to **Agent Environment Run Variables** (see above). |
| `amplifier-agent: command not found` when paperclip launches a turn | `amplifier-agent` not on PATH | `uv tool install git+https://github.com/microsoft/amplifier-agent`; ensure `~/.local/bin` is on `PATH`. |
| First heartbeat is very slow (~30s) | Engine is materializing skills + downloading provider modules into `~/.amplifier/cache/` | One-time cost. Subsequent runs are fast. |

## How the adapter is integrated

The adapter is part of this fork as real source files, not an overlay or patch. The
divergence surface from upstream paperclip is enumerated in `KNOWN_DIVERGENCE.md`.

The key paths:

| Path | What |
|---|---|
| `packages/adapters/amplifier-local/` | The adapter workspace package (TS source + 38 vitest tests) |
| `ui/src/adapters/amplifier-local/` | React `ConfigFields` + `UIAdapterModule` |
| `server/src/adapters/registry.ts` | Server-side adapter registration |
| `ui/src/adapters/registry.ts` | UI-side adapter registration |
| `cli/src/adapters/registry.ts` | CLI-side adapter registration |
| `{server,ui,cli}/package.json` | Workspace dependency `@paperclipai/adapter-amplifier-local` |

To inspect everything the fork adds:
```bash
git remote add upstream https://github.com/paperclipai/paperclip 2>/dev/null
git fetch upstream
git diff $(cat UPSTREAM_PIN)..HEAD
```

## Long-term plan

This fork exists because upstream paperclip's contribution channel for external adapters
isn't open to us yet. When it opens, the `amplifier_local` adapter will be PR'd upstream
and this fork will either become a thin shim or be archived.

Until then: monthly upstream syncs per `UPSTREAM_SYNC.md`.
