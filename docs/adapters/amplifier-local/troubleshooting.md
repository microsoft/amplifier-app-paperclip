# amplifier-local adapter — troubleshooting

Failure-mode lookup for running paperclip with the `amplifier_local` adapter.
For install-and-run instructions see the [repository README](../../../README.md).
For how the adapter is wired in, see [`integration.md`](./integration.md).

| Symptom | Cause | Fix |
|---|---|---|
| `Agent JWT: missing (run pnpm paperclipai onboard)` in dev console, or local-agent runs fail to authenticate | Fresh install — onboarding has not been run. The board user and JWT signing secret don't exist yet. | `pnpm paperclipai onboard --yes` (creates the board user + writes `PAPERCLIP_AGENT_JWT_SECRET` to the instance `.env`, then restarts the server) |
| Heartbeat fails with `Cannot initialize without orchestrator … 'uv' is not installed` | The engine subprocess can't find `uv` on PATH because paperclip is running as a different user than the one that installed `amplifier-agent`/`uv` | Install `amplifier-agent` as the same user that runs paperclip (`curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh \| bash`) and confirm `~/.local/bin` is on that user's PATH |
| `Error: You are running this script as root. Postgres does not support running as root` on `pnpm dev` | Embedded PostgreSQL refuses root | Create and switch to a non-root user before continuing |
| `amplifier_local` doesn't appear in the adapter type dropdown | Build wasn't run or failed | Run `pnpm install` — check for errors in the adapter workspace package at `packages/adapters/amplifier-local/` |
| Agent runs hit `No approval provider registered, auto-denying` in stderr | `amplifier-agent` older than `0.6.0` — the bundled `hooks-approval` module was unmounted upstream (originally in `0.5.1`, carried through to the `0.6.0` minimum required here) | `amplifier-agent update` (or reinstall via the installer script: `curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh \| bash`) |
| Run log shows `Skipping symlink that escapes skill directory boundary` | Adapter older than [PR #5](https://github.com/microsoft/amplifier-app-paperclip/pull/5) (was symlinking skills instead of copying them) | `git pull` and `pnpm install` to pick up the materialization fix |
| Engine spawn fails with `No such option '--provider'` (or `--model` / `--effort`) | Adapter is calling `amplifier-agent run` with provider/model/effort argv that was removed from the engine in the `0.6.0` release wave (host_config is the single source of truth now) | Bump `amplifier-agent` to `>= 0.6.0` AND rebuild the paperclip adapter dist (`pnpm --filter @paperclipai/adapter-amplifier-local build`) so the stale compiled JS in `packages/adapters/amplifier-local/dist/server/` no longer emits the deprecated flags |
| `provider_init_failed` on the first heartbeat | API key missing from the agent's env vars | Add the right key to **Agent Environment Run Variables** (see the README's "Configure your agent's API key") |
| `amplifier-agent: command not found` when paperclip launches a turn | Not on PATH for the running user | Install via `curl -fsSL https://raw.githubusercontent.com/microsoft/amplifier-agent/main/install.sh \| bash`; ensure `~/.local/bin` is on `PATH` |
| First heartbeat is slow (~30s) | Engine materializing skills and downloading provider modules into `~/.amplifier-agent/cache/` (unified storage root introduced alongside the `0.6.0` minimum; older versions used XDG paths under `~/.cache/amplifier-agent/` and `~/.local/state/amplifier-agent/`) | One-time cost. Subsequent runs are fast. |
| Wrong model output / token count zeros | Engine version mismatch | Confirm `amplifier-agent --version` reports >= 0.9.1 |
| Server is up but I can't reach it from another machine | Server binds `127.0.0.1` only by design | Use an SSH tunnel (`ssh -L 3100:127.0.0.1:3100 <host>`) or set up a reverse proxy |
