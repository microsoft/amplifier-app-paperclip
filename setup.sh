#!/usr/bin/env bash
# setup.sh — Turn-key installer for the amplifier-local paperclip adapter.
#
# Clones paperclip at a pinned commit, applies the amplifier-local adapter
# overlay, installs deps, runs tests, and optionally starts the dev server.
#
# Environment variables (all optional):
#   PAPERCLIP_DIR   Where to clone paperclip (default: ./paperclip)
#   RUN_DEV         Set 0 to skip pnpm dev at the end (default: 1)
#   RUN_TESTS       Set 0 to skip adapter unit tests (default: 1)
#
# Re-running is safe: the clone is updated to the pinned SHA, overlay edits
# are idempotent, and deps are re-installed.

set -euo pipefail

# ---------- configuration ----------
PAPERCLIP_DIR="${PAPERCLIP_DIR:-./paperclip}"
RUN_DEV="${RUN_DEV:-1}"
RUN_TESTS="${RUN_TESTS:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAPERCLIP_REPO="$(cat "$SCRIPT_DIR/PAPERCLIP_REPO")"
PAPERCLIP_REF="$(cat "$SCRIPT_DIR/PAPERCLIP_REF")"

# ---------- helpers ----------
step() { echo; echo "==> Step $1: $2"; }
info() { echo "    $*"; }
warn() { echo "    [WARN] $*"; }
die()  {
  echo
  echo "  FAILED: $*"
  echo "  Working directory: $(pwd)"
  echo "  Hint: re-run with 'bash -x setup.sh' for verbose output."
  exit 1
}

# ---------- Step 1: preflight checks ----------
step 1 "Preflight checks"

# node >= 18
if ! node --version &>/dev/null; then
  die "node not found on PATH. Install Node.js 18+ from https://nodejs.org/"
fi
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ required (found $(node --version)). Upgrade at https://nodejs.org/"
fi
info "node $(node --version) ✓"

# pnpm >= 9
if ! pnpm --version &>/dev/null; then
  die "pnpm not found on PATH. Install via: npm install -g pnpm@latest"
fi
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [ "$PNPM_MAJOR" -lt 9 ]; then
  die "pnpm 9+ required (found $(pnpm --version)). Upgrade: npm install -g pnpm@latest"
fi
info "pnpm $(pnpm --version) ✓"

# git
if ! git --version &>/dev/null; then
  die "git not found on PATH."
fi
info "git $(git --version | awk '{print $3}') ✓"

# amplifier-agent — version-gated check (warn only — non-fatal so users can
# still produce a built paperclip clone even without the engine on PATH).
#
# Required:    0.5.0+ (host_config layer + G3 fail-fast on headless approval)
# Recommended: 0.5.1+ (hooks-approval default-mount removed — needed for
#                       reliable delegation flows; before 0.5.1, sub-session
#                       bash/curl calls auto-denied with "No approval
#                       provider registered").
#
# Bump these when a new release ships. AMPLIFIER_TAG controls which ref
# the recommended install command points at — use `main` until a release
# tag exists, then switch to `vX.Y.Z` once tagged.
AMPLIFIER_MIN_VERSION="0.5.0"
AMPLIFIER_RECOMMENDED_VERSION="0.5.1"
AMPLIFIER_TAG="main"

# ver_lt A B  — returns 0 (true) when A < B by semver-ish ordering.
# Uses sort -V which handles "0.5.0" < "0.5.1" < "0.5.10" correctly.
ver_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

if ! command -v amplifier-agent &>/dev/null; then
  warn "amplifier-agent not found on PATH."
  warn "The adapter requires amplifier-agent >= $AMPLIFIER_MIN_VERSION at runtime."
  warn "Install:"
  warn "  uv tool install git+https://github.com/microsoft/amplifier-agent@$AMPLIFIER_TAG"
else
  # Extract just the version number from `amplifier-agent --version`, which
  # prints e.g. "amplifier-agent, version 0.5.0". Falls back to empty if the
  # output shape ever changes.
  AMPLIFIER_VERSION=$(amplifier-agent --version 2>/dev/null | awk '{print $NF}')
  if [ -z "$AMPLIFIER_VERSION" ]; then
    warn "amplifier-agent is installed but its version could not be determined."
    warn "Force-reinstall:"
    warn "  uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@$AMPLIFIER_TAG"
  elif ver_lt "$AMPLIFIER_VERSION" "$AMPLIFIER_MIN_VERSION"; then
    warn "amplifier-agent $AMPLIFIER_VERSION found, but >= $AMPLIFIER_MIN_VERSION is REQUIRED."
    warn "The setup will continue, but the adapter WILL FAIL at runtime."
    warn "Force-reinstall:"
    warn "  uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@$AMPLIFIER_TAG"
  elif ver_lt "$AMPLIFIER_VERSION" "$AMPLIFIER_RECOMMENDED_VERSION"; then
    info "amplifier-agent $AMPLIFIER_VERSION ✓ (works, but $AMPLIFIER_RECOMMENDED_VERSION recommended for delegation)"
    info "Upgrade (recommended):"
    info "  uv tool install --reinstall --force git+https://github.com/microsoft/amplifier-agent@$AMPLIFIER_TAG"
  else
    info "amplifier-agent $AMPLIFIER_VERSION ✓"
  fi
fi

# ---------- Step 2: clone or update paperclip at pinned SHA ----------
step 2 "Clone/update paperclip at $PAPERCLIP_REF"

# Robust clone gate: treat a missing OR empty OR non-git directory as needing
# a fresh clone. The earlier "dir exists" check was tripped when users
# pre-created PAPERCLIP_DIR (e.g. via `mkdir -p` thinking it was required),
# which made the script skip the clone and then fail at `git fetch`.
NEEDS_CLONE=0
if [ ! -e "$PAPERCLIP_DIR" ]; then
  NEEDS_CLONE=1
elif [ ! -e "$PAPERCLIP_DIR/.git" ]; then
  # Path exists but isn't a git repo.
  if [ -z "$(ls -A "$PAPERCLIP_DIR" 2>/dev/null || true)" ]; then
    # Empty directory — safe to remove and clone into.
    info "$PAPERCLIP_DIR exists but is empty; removing so we can clone into it."
    rmdir "$PAPERCLIP_DIR" || die "could not remove empty dir $PAPERCLIP_DIR"
    NEEDS_CLONE=1
  else
    die "PAPERCLIP_DIR ($PAPERCLIP_DIR) exists but is not a git repository. Remove it, or set PAPERCLIP_DIR to a different path, then re-run."
  fi
fi

if [ "$NEEDS_CLONE" = "1" ]; then
  info "Cloning https://github.com/$PAPERCLIP_REPO ..."
  git clone "https://github.com/$PAPERCLIP_REPO" "$PAPERCLIP_DIR" \
    || die "git clone failed"
fi

info "Fetching and checking out $PAPERCLIP_REF ..."
(
  cd "$PAPERCLIP_DIR"
  git fetch origin "$PAPERCLIP_REF" 2>/dev/null \
    || git fetch origin              # full fetch if single-ref fetch fails
  git checkout --detach "$PAPERCLIP_REF" \
    || die "git checkout $PAPERCLIP_REF failed"
)

ACTUAL_SHA=$(git -C "$PAPERCLIP_DIR" rev-parse HEAD)
if [[ "$ACTUAL_SHA" != "${PAPERCLIP_REF}"* ]]; then
  die "HEAD is $ACTUAL_SHA but expected $PAPERCLIP_REF"
fi
info "HEAD is $ACTUAL_SHA ✓"

# ---------- Step 3: copy adapter directory ----------
step 3 "Copy adapter package → packages/adapters/amplifier-local/"

ADAPTER_DEST="$PAPERCLIP_DIR/packages/adapters/amplifier-local"
mkdir -p "$ADAPTER_DEST"
cp -R "$SCRIPT_DIR/adapter/." "$ADAPTER_DEST/"
info "Copied adapter/ → $ADAPTER_DEST ✓"

# ---------- Step 4: copy UI overlay ----------
step 4 "Copy UI overlay → ui/src/adapters/amplifier-local/"

UI_DEST="$PAPERCLIP_DIR/ui/src/adapters/amplifier-local"
mkdir -p "$UI_DEST"
cp -R "$SCRIPT_DIR/paperclip-ui-overlay/." "$UI_DEST/"
info "Copied paperclip-ui-overlay/ → $UI_DEST ✓"

# ---------- Step 5: apply overlay (registry + package.json edits) ----------
step 5 "Apply registry overlay (idempotent)"

node "$SCRIPT_DIR/apply-overlay.mjs" "$PAPERCLIP_DIR" \
  || die "apply-overlay.mjs exited non-zero"

# ---------- Step 6: install deps ----------
step 6 "pnpm install"

(cd "$PAPERCLIP_DIR" && pnpm install) \
  || die "pnpm install failed — check pnpm output above"

info "Dependencies installed ✓"

# ---------- Step 7: adapter unit tests (optional) ----------
if [ "$RUN_TESTS" = "1" ]; then
  step 7 "Adapter unit tests"

  (
    cd "$PAPERCLIP_DIR/packages/adapters/amplifier-local"
    pnpm exec vitest run --reporter=verbose 2>&1
  ) || die "Adapter unit tests failed — see output above"

  info "Tests passed ✓"
else
  step 7 "Adapter unit tests [SKIPPED — RUN_TESTS=0]"
fi

# ---------- Step 8: typecheck ----------
step 8 "Typecheck"

(cd "$PAPERCLIP_DIR" && pnpm --filter @paperclipai/adapter-amplifier-local typecheck) \
  || die "Typecheck failed for @paperclipai/adapter-amplifier-local"
info "@paperclipai/adapter-amplifier-local typecheck ✓"

(cd "$PAPERCLIP_DIR" && pnpm --filter @paperclipai/server typecheck) \
  || die "Typecheck failed for @paperclipai/server"
info "@paperclipai/server typecheck ✓"

(cd "$PAPERCLIP_DIR" && pnpm --filter @paperclipai/ui typecheck) \
  || die "Typecheck failed for @paperclipai/ui"
info "@paperclipai/ui typecheck ✓"

# ---------- Step 9: worktree init (first-time only) ----------
step 9 "Worktree init"

if [ ! -f "$PAPERCLIP_DIR/.paperclip/.env" ]; then
  info "Seeding per-worktree database (.paperclip/.env not found) ..."
  (cd "$PAPERCLIP_DIR" && pnpm paperclipai worktree init) \
    || die "worktree init failed — check pnpm output above"
  info "Worktree init ✓"
else
  info ".paperclip/.env already exists — skipping worktree init"
fi

# ---------- Step 10: start dev server (optional) ----------
if [ "$RUN_DEV" = "1" ]; then
  step 10 "Start dev server"
  echo
  echo "  ============================================================"
  echo "  Open http://127.0.0.1:3101 once the server is ready."
  echo "  Look for 'amplifier_local' in the adapter type dropdown"
  echo "  when creating or editing an agent."
  echo "  ============================================================"
  echo
  (cd "$PAPERCLIP_DIR" && pnpm dev)
else
  step 10 "Dev server [SKIPPED — RUN_DEV=0]"
  echo
  echo "  Installation complete. To start the dev server:"
  echo "    cd $PAPERCLIP_DIR && pnpm dev"
  echo
  echo "  Then open http://127.0.0.1:3101 and look for"
  echo "  'amplifier_local' in the adapter type dropdown."
fi
