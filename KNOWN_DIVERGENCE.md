# Known Divergence from Upstream

This file enumerates the surface where the fork diverges from
[paperclipai/paperclip](https://github.com/paperclipai/paperclip). It exists so that during
upstream sync (see `UPSTREAM_SYNC.md`) the maintainer knows exactly which files to watch
for conflicts.

When the divergence list grows, the fork is harder to maintain. When it shrinks, the fork
is closer to its own deprecation. Both are useful signals.

## Files added by the fork

| Path | Purpose |
|---|---|
| `packages/adapters/amplifier-local/` | The adapter package itself (TS source, vitest tests, package.json) |
| `ui/src/adapters/amplifier-local/` | React `ConfigFields` + `UIAdapterModule` |
| `PAPERCLIP-README.md` | Verbatim copy of upstream paperclip's README, preserved for reference |
| `UPSTREAM_SYNC.md` | Sync procedure for keeping current with upstream |
| `KNOWN_DIVERGENCE.md` | This file |
| `NOTICE.md` | Copyright attribution for the combined work |
| `UPSTREAM_PIN` | The upstream paperclip SHA at last sync |
| `CODE_OF_CONDUCT.md` | Microsoft OSS compliance |
| `SUPPORT.md` | Microsoft OSS compliance |

## Files modified by the fork

| Path | Modification |
|---|---|
| `README.md` | Replaced entirely with an `amplifier_local`-focused setup guide. Paperclip's original README content is preserved verbatim in `PAPERCLIP-README.md`. |
| `SECURITY.md` | Replaced with the Microsoft OSS compliance variant. (Paperclip's original was 322 bytes; the Microsoft version is the standard MSRC pattern.) |
| `server/src/adapters/registry.ts` | Added `amplifierLocalAdapter` import + object + registration entry |
| `ui/src/adapters/registry.ts` | Added `amplifierLocalUIAdapter` import + entry |
| `cli/src/adapters/registry.ts` | Added `amplifierLocalCLIAdapter` import + object + Map entry |
| `server/package.json` | Added `"@paperclipai/adapter-amplifier-local": "workspace:*"` to dependencies |
| `ui/package.json` | Same |
| `cli/package.json` | Same |
| `pnpm-lock.yaml` | Workspace dep entries for the adapter package |

## Files preserved as-is from upstream

Everything not listed above. The combined diff against the upstream pin:

```bash
git remote add upstream https://github.com/paperclipai/paperclip 2>/dev/null
git fetch upstream
git diff $(cat UPSTREAM_PIN)..HEAD
```

## When upstream touches any modified file above

The upstream sync (`UPSTREAM_SYNC.md`) is the place where the merge happens. Rule of thumb:

- **adapter package files**: should never conflict — upstream doesn't have this package.
- **registry files**: most likely place for conflicts. Reapply the amplifier_local registration on top of whatever shape upstream adopted.
- **`README.md`**: upstream changes go into `PAPERCLIP-README.md` (verbatim copy). The fork-side `README.md` stays as the amplifier_local-focused entry point.
