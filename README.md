# amplifier-app-paperclip

A turn-key installer that clones [paperclip](https://github.com/paperclipai/paperclip) at a
pinned commit, applies the `amplifier-local` adapter overlay, and starts the service. The
adapter lets paperclip agents run on the
[Amplifier engine](https://github.com/microsoft/amplifier-agent).

## Prerequisites

- Node 18+
- pnpm 9+
- git
- `amplifier-agent` 0.5.0+ on PATH
  ```
  uv tool install git+https://github.com/microsoft/amplifier-agent
  ```
- An LLM provider API key (typically `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)

## Quick start

```bash
git clone https://github.com/microsoft/amplifier-app-paperclip
cd amplifier-app-paperclip
./setup.sh
```

The script will:
1. Clone paperclip at the pinned commit (`8014445b`) into `./paperclip/`
2. Copy the `amplifier-local` adapter package + UI integration into the clone
3. Apply idempotent registry edits (imports, object definitions, workspace deps)
4. `pnpm install`
5. Run the adapter's 38 unit tests
6. Typecheck the adapter, server, and UI
7. Seed a per-worktree database (first run only)
8. Start paperclip's dev server

Open **http://127.0.0.1:3101** — look for `amplifier_local` in the adapter type dropdown
when creating or editing an agent.

## Configure your agent's API key

The Amplifier engine reads the provider API key from the **agent's environment variables**,
not from the host shell. Every agent that uses the `amplifier_local` adapter needs its own
key configured in the UI:

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

## What gets installed

The overlay adds the `amplifier-local` adapter to paperclip at the same integration depth as
the built-in `claude_local` and `codex_local` adapters:

| Path in paperclip clone | What |
|---|---|
| `packages/adapters/amplifier-local/` | Adapter workspace package (TS source + tests) |
| `ui/src/adapters/amplifier-local/` | UI integration (React `ConfigFields` + `UIAdapterModule`) |
| `server/src/adapters/registry.ts` | Import block + `amplifierLocalAdapter` object + registration |
| `ui/src/adapters/registry.ts` | Import + `registerBuiltInUIAdapters` entry |
| `cli/src/adapters/registry.ts` | Import + object + Map entry |
| `server/package.json` | `"@paperclipai/adapter-amplifier-local": "workspace:*"` |
| `ui/package.json` | Same |
| `cli/package.json` | Same |

All overlay edits are idempotent (sentinel-marker guarded), so re-running `setup.sh` is safe.

## Configuration

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PAPERCLIP_DIR` | `./paperclip` | Where to clone/update paperclip |
| `RUN_DEV` | `1` | Set `0` to stop after install (no dev server) |
| `RUN_TESTS` | `1` | Set `0` to skip adapter unit tests |

Examples:

```bash
# Install only, no dev server, no tests
RUN_DEV=0 RUN_TESTS=0 ./setup.sh

# Install into a custom directory
PAPERCLIP_DIR=/opt/paperclip RUN_DEV=0 ./setup.sh

# Refresh the adapter after pulling new changes in this repo
RUN_DEV=0 ./setup.sh
```

To pin a different paperclip ref, edit `PAPERCLIP_REF` and re-run `./setup.sh`.
(Note: registry shapes may change upstream; if the overlay fails to apply, file an issue.)

## Updating the adapter

```bash
# Pull latest adapter changes from this repo
git pull

# Re-apply over the existing paperclip clone (safe to re-run)
RUN_DEV=0 ./setup.sh
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Step 2: fatal: not a git repository ... .git` | `PAPERCLIP_DIR` exists as a non-git directory (e.g. pre-created via `mkdir -p` before running setup) | Setup now handles this automatically: empty dirs are removed and re-cloned; non-empty non-git dirs error out with a clear message. If you see the old form of the error, you're on an outdated `setup.sh` — `git pull` and re-run. |
| `Step 5: Apply registry overlay` reports failures | paperclip's registry files have drifted upstream so the string anchors no longer match | Either pin `PAPERCLIP_REF` to the last known-good SHA, or file an issue with the upstream paperclip ref you tried. Hand-edit recovery: re-apply the overlay manually following the sentinel-marker patterns. |
| `amplifier-agent` not found warning | `amplifier-agent` not on PATH | `uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent`; ensure `~/.local/bin` is on `PATH`. |
| Dev server starts but agent runs hit `No approval provider registered, auto-denying` | `amplifier-agent` < 0.5.1 (the version that unmounted `hooks-approval` by default) | Upgrade: `amplifier-agent update` (>=0.5.0) or reinstall via `uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent`. |
| `Step 9: pnpm paperclipai worktree init` blocked or hung | Existing worktree state for the instance you cloned | Wipe with `rm -rf ~/.paperclip-worktrees/instances/<instance-name>` and re-run. |

Re-running `setup.sh` is always safe — overlay edits are idempotent.

## Architecture

This repo implements **Option A (full overlay)**: we ship the adapter source alongside an
installer that overlays it onto a pinned paperclip clone. The overlay approach trades some
maintenance burden for full UX parity with built-in adapters (custom React `ConfigFields`,
native `formatStdoutEvent`, etc.).

Alternatives considered:

- **Option B (plugin):** ship as an external adapter plugin via paperclip's documented plugin
  system. Server-side fully equivalent; UI side limited to schema-driven forms (no custom
  React); CLI side not supported. We chose A to preserve UX consistency and to retain
  flexibility for engine evolution that wants richer UI.
- **Option C (plugin + tiny overlay):** mostly plugin, with a minimal patch for CLI parity.
  Same UI trade-off as B.

The longer-term path is to graduate this adapter into paperclip's built-in adapter set
upstream once contribution channels open.

### Layout

```
amplifier-app-paperclip/
├── adapter/                  Mirror of packages/adapters/amplifier-local/ (committed source only)
├── paperclip-ui-overlay/     Mirror of ui/src/adapters/amplifier-local/
├── apply-overlay.mjs         Idempotent Node script — registry + package.json edits
├── setup.sh                  Main installer (bash)
├── PAPERCLIP_REF             Pinned paperclip commit SHA
└── PAPERCLIP_REPO            paperclipai/paperclip
```

### How the overlay works

`setup.sh` runs `apply-overlay.mjs <paperclip-dir>` which edits 6 files in the paperclip
clone using stable string anchors. Each edit is guarded by a sentinel string; if the sentinel
is already present the edit is skipped — making the script idempotent and safe to re-run.

## License

MIT — see [LICENSE](LICENSE).
