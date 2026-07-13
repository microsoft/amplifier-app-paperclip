# amplifier-app-paperclip

Setting up [paperclip](https://github.com/paperclipai/paperclip) with the **`amplifier_local`** adapter,
which lets paperclip agents run on the [Amplifier engine](https://github.com/microsoft/amplifier-agent).

This README covers **installing and running** paperclip with `amplifier-agent`. For everything else:

- **How the adapter is integrated, engine-version compatibility, and fork details** → [`docs/adapters/amplifier-local/integration.md`](docs/adapters/amplifier-local/integration.md)
- **Troubleshooting** (failure-mode lookup) → [`docs/adapters/amplifier-local/troubleshooting.md`](docs/adapters/amplifier-local/troubleshooting.md)

## Prerequisites

- A **non-root user** — paperclip uses an embedded PostgreSQL that refuses to run as root. Create or switch to a normal user account before continuing.
- Node 18+ (Node 22 LTS recommended)
- pnpm 9+ (`npm install -g pnpm@latest`)
- git
- `uv` for installing the engine (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- `amplifier-agent` **>= 0.6.0**, installed *as the same user that will run paperclip*. The paperclip server invokes `amplifier-agent` per turn and inherits the user's PATH to find both `amplifier-agent` and `uv`. Installing as a different user (e.g. root) silently breaks heartbeats. Use the official installer script, which installs the latest release and primes the bundle cache so the first run is instant:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh | bash
  # to pin a specific version instead of latest:
  #   curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh | bash -s -- --tag v0.6.0
  # ensure ~/.local/bin is on PATH; verify:
  amplifier-agent version --json   # → {"version":"0.6.0","protocolVersion":"0.3.0"}
  ```
- An LLM provider API key for the model you'll use. Set it once via `amplifier-agent auth set <provider> <key>` (persists to `~/.amplifier-agent/credentials.json`, picked up automatically by every `amplifier_local` agent), or **per-agent** in the paperclip UI — see [Configure your agent's API key](#configure-your-agents-api-key).

## Quick start

```bash
git clone https://github.com/microsoft/amplifier-app-paperclip
cd amplifier-app-paperclip
pnpm install

# Optional but recommended: register provider credentials with amplifier-agent
# BEFORE starting the server. amplifier-agent auto-enables every provider
# whose credentials resolve (this persists to ~/.amplifier-agent/credentials.json,
# so it survives across shells/reboots — no re-exporting needed).
amplifier-agent auth set anthropic sk-ant-...   # for claude-* models
amplifier-agent auth set openai sk-...          # for gpt-* / o3-* / o4-* models
# Add only the providers you actually use.

pnpm paperclipai onboard --yes   # one-time: creates board user + Agent JWT secret, then runs the server
```

`onboard --yes` combines initial setup and `pnpm dev`. For subsequent runs (after the first onboarding) use `pnpm dev` directly — credentials set via `amplifier-agent auth set` persist across runs automatically.

Open **http://127.0.0.1:3100** — look for `amplifier_local` in the adapter type dropdown when creating or editing an agent. (The server binds to `127.0.0.1` only; if you need to reach it from another machine, set up an SSH tunnel or reverse proxy.)

If you skipped the `auth set` step or want different keys per agent, set them per-agent via the UI instead — see [Configure your agent's API key](#configure-your-agents-api-key) below. Both paths work; per-agent `config.env` always overrides amplifier-agent's own credential resolution on collision.

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
# expect: {"version":"0.6.0","protocolVersion":"0.3.0"}
```

**Note:** `/api/health` returns `authReady: true` even *before* onboarding has run, so health alone is not a sufficient check. The dev-server console banner shows `Agent JWT: set` once onboarding has completed — that's the authoritative signal. If you see `Agent JWT: missing`, re-run `pnpm paperclipai onboard --yes`.

Once you've configured an agent (see next section) and triggered its first heartbeat, the run log under `~/.paperclip-worktrees/instances/<id>/data/runs/<run-id>/` should contain:
- zero `Skipping symlink that escapes skill directory boundary` lines
- zero `No approval provider registered, auto-denying` lines
- zero `'dict' object has no attribute 'approved'` lines
- zero `Cannot initialize without orchestrator` lines
- one or more `[paperclip] Materialized amplifier-local skill "<name>"` lines on the first run

`GET /api/agents/<agent-id>/runtime-state` should report `lastRunStatus: "succeeded"`.

If something is off, see [`docs/adapters/amplifier-local/troubleshooting.md`](docs/adapters/amplifier-local/troubleshooting.md).

## Configure your agent's API key

The `amplifier_local` adapter itself does not manage provider credentials — that's amplifier-agent's job. `amplifier-agent serve` / `run` auto-enable every provider whose credentials resolve, from either of these sources (amplifier-agent's own precedence):

1. **Per-agent** — set in the agent's edit form (Agent Environment Run Variables), passed through to the subprocess env. Wins on collision with amplifier-agent's own credential resolution.
2. **amplifier-agent's credential store** — environment variable (e.g. `ANTHROPIC_API_KEY`) in the shell that runs paperclip, or `~/.amplifier-agent/credentials.json` written by `amplifier-agent auth set <provider> <key>`. Shared across every `amplifier_local` agent on the host.

Pick whichever fits. `amplifier-agent auth set` is the common case for single-user dev (persists across shells/reboots, unlike a plain `export`). Per-agent `config.env` is required for multi-tenant deployments where each agent needs distinct credentials.

Run `amplifier-agent providers list --json` at any time to see which providers currently resolve and from what source, without exposing the credential material itself. The adapter's **Test environment** diagnostic surfaces the same information for the agent's model's derived provider:

| Model prefix | Derived provider |
|---|---|
| `claude-*` | `anthropic` |
| `gpt-*`, `o1-*`–`o9-*`, `text-davinci-*` | `openai` |
| `llama*`, `mistral*`, `qwen*`, `deepseek*`, `phi*` | `ollama` |
| anything else | `anthropic` (default) |

Set `config.provider` explicitly (e.g. `"azure-openai"`) to override the derived provider — useful when a model name is ambiguous (e.g. `gpt-*` served via Azure instead of OpenAI directly).

### Option A — amplifier-agent auth set (simplest, single-user dev)

```bash
amplifier-agent auth set anthropic sk-ant-...
pnpm dev
```

Every `amplifier_local` agent automatically picks up the key. Confirm it landed by running `amplifier-agent providers list --json` (or clicking **Test environment** on the agent) and checking for `"resolvable": true`.

### Option B — Per-agent (multi-tenant, or when you need distinct keys per agent)

1. Create or open an agent that uses `amplifier_local`.
2. In the agent's edit form, find the **Agent Environment Run Variables** section.
3. Add a key-value pair for the provider's API key (e.g. `ANTHROPIC_API_KEY`). Choose the `plain` value type, or use `secret_ref` if you have a secret store wired.
4. Save the agent. Then click **Test environment** — you should see `amplifier_provider_key_present` (info, green) in the diagnostics.

Per-agent values always override amplifier-agent's own credential resolution on collision.

If no key is available from either source, the first heartbeat fails with `provider_init_failed` or `provider_not_configured`. Fix by setting the credential via Option A or B and re-triggering the heartbeat.

## Updating

```bash
git pull
pnpm install   # only if package.json / pnpm-lock changed
pnpm dev
```

When upstream paperclip ships changes, they land here through periodic merges — see [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md).

To update the engine itself, run `amplifier-agent update` (see [engine-version compatibility](docs/adapters/amplifier-local/integration.md#engine-version-compatibility)).

## License

MIT. See [`LICENSE`](LICENSE) (original Paperclip AI copyright preserved) and [`NOTICE.md`](NOTICE.md)
(Microsoft additions attribution).

## Contributing

> [!NOTE]
> This project is not currently accepting external contributions, but we're actively working toward opening this up. We value community input and look forward to collaborating in the future. For now, feel free to fork and experiment!

Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
