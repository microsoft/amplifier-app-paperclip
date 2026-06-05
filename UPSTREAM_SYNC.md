# Upstream Sync Procedure

This is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) maintained
by Microsoft. The fork integrates the `amplifier-local` adapter and otherwise tracks upstream.

The pin reference is recorded in `UPSTREAM_PIN`; merges from upstream advance it.

## Target cadence

- **Monthly** — merge `upstream/master` into a sync branch and open a PR.
- **Out-of-band** — when upstream ships a critical security patch, merge immediately.

If three cadences pass without a sync, the fork is failing. File an issue.

## Procedure

```bash
# 1. Ensure the upstream remote is configured (one-time setup)
git remote add upstream https://github.com/paperclipai/paperclip 2>/dev/null || true
git fetch upstream

# 2. See what's new upstream since the last sync
git log --oneline HEAD..upstream/master

# 3. Create a sync branch
git checkout -b chore/sync-upstream-$(date +%Y%m%d)

# 4. Merge upstream changes
git merge upstream/master

# 5. Resolve conflicts — they will land in the files listed in KNOWN_DIVERGENCE.md.
#    See the "Conflict resolution rules" section below for guidance.

# 6. Update the pin file
git rev-parse upstream/master > UPSTREAM_PIN
git add UPSTREAM_PIN

# 7. Verify the fork still works
pnpm install
pnpm --filter @paperclipai/adapter-amplifier-local exec vitest run
pnpm --filter @paperclipai/adapter-amplifier-local typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck

# 8. Commit + push + PR
git commit -m "chore: sync upstream paperclip $(cat UPSTREAM_PIN | head -c 8)"
git push origin HEAD
gh pr create --title "chore: sync upstream paperclip" --draft
```

## Conflict resolution rules

| Conflict in | What to do |
|---|---|
| `server/src/adapters/registry.ts` | Preserve the `amplifierLocalAdapter` import + entry. Reapply onto upstream's new structure. |
| `ui/src/adapters/registry.ts` | Preserve the `amplifierLocalUIAdapter` registration. |
| `cli/src/adapters/registry.ts` | Preserve the `amplifierLocalCLIAdapter` entry. |
| `server/package.json`, `ui/package.json`, `cli/package.json` | Keep `"@paperclipai/adapter-amplifier-local": "workspace:*"` in dependencies. |
| `pnpm-lock.yaml` | Accept upstream's, then re-run `pnpm install` to regenerate with our additions. |
| `packages/adapters/amplifier-local/**` | Our adapter package is isolated. If a conflict appears here, upstream has touched our package directory — investigate before resolving. |
| `README.md` | Preserve the fork notice banner at the top; accept upstream's content below. |
| `SECURITY.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md` | Keep the Microsoft OSS compliance versions. Upstream's are merged in only when materially different. |

## What goes upstream vs stays here

When this fork adds something general-purpose (not Amplifier-specific), consider PR'ing it
upstream instead. Things that should stay in the fork:

- Anything inside `packages/adapters/amplifier-local/` or `ui/src/adapters/amplifier-local/`
- `AMPLIFIER-LOCAL.md`, this file, `KNOWN_DIVERGENCE.md`, `NOTICE.md`
- Microsoft OSS compliance files

Anything else worth keeping is worth upstreaming first.

## Migration goal

The end state for this fork is its own deprecation: when paperclip accepts the
`amplifier-local` adapter upstream, this fork becomes a thin shim or is archived.
See `KNOWN_DIVERGENCE.md` for the current divergence surface.
