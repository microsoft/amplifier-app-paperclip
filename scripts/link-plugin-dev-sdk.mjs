#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Link the local plugin-sdk into a plugin package's node_modules.
 *
 * Idempotent by design — safe to call even when pnpm has already created the
 * workspace symlink before postinstall runs (the scenario that produced the
 * EEXIST crash on Node >= 22/24).
 *
 *  - Symlink already resolves to sdkDir → do nothing (fast exit).
 *  - Symlink points elsewhere → replace it with unlinkSync (never rmSync).
 *  - Real (non-symlink) directory exists → leave it in place.
 *  - Nothing exists → create the symlink.
 *
 * Why unlinkSync, not rmSync:
 *   On Node >= 22/24, `rmSync(symlinkToDir, { force: true })` throws
 *   ERR_FS_EISDIR instead of unlinking the symlink. unlinkSync removes only
 *   the symlink entry without touching the target directory.
 *
 * @param {{ packageDir: string, repoRoot: string }} opts
 */
export function linkPluginDevSdk({ packageDir, repoRoot }) {
  const sdkDir = join(repoRoot, "packages", "plugins", "sdk");
  const scopeDir = join(packageDir, "node_modules", "@paperclipai");
  const linkTarget = join(scopeDir, "plugin-sdk");

  if (!existsSync(join(packageDir, "package.json"))) {
    throw new Error(`No package.json found in plugin directory: ${packageDir}`);
  }

  mkdirSync(scopeDir, { recursive: true });

  let stat;
  try {
    stat = lstatSync(linkTarget);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    stat = null; // target does not exist yet — fall through to create
  }

  if (stat !== null) {
    if (stat.isSymbolicLink()) {
      // Resolve the existing link and compare to sdkDir.
      // resolve() normalises both sides so trailing slashes / case differences
      // do not produce false mismatches.
      const existingResolved = resolve(scopeDir, readlinkSync(linkTarget));
      if (existingResolved === sdkDir) {
        console.log(`  i @paperclipai/plugin-sdk already linked for ${packageDir}`);
        return;
      }
      // Symlink points somewhere else — remove it with unlinkSync, which
      // correctly removes a symlink-to-directory on all Node versions.
      unlinkSync(linkTarget);
    } else {
      // Real installed directory — leave it in place.
      console.log("  i Keeping existing installed @paperclipai/plugin-sdk directory in place");
      return;
    }
  }

  const relativeSdkDir = relative(scopeDir, sdkDir);
  try {
    symlinkSync(relativeSdkDir, linkTarget, "dir");
  } catch (err) {
    // Defense-in-depth: if a concurrent process created the link between our
    // lstat and symlinkSync, treat EEXIST as success.
    if (err.code !== "EEXIST") throw err;
  }

  console.log(`  ✓ Linked local @paperclipai/plugin-sdk for ${packageDir}`);
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    linkPluginDevSdk({ packageDir: process.cwd(), repoRoot });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
