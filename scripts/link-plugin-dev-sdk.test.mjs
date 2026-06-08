import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { linkPluginDevSdk } from "./link-plugin-dev-sdk.mjs";

/**
 * Build a minimal repo temp tree:
 *   <tmpRoot>/packages/plugins/sdk/  (fake sdk, with a sentinel file)
 *   <tmpRoot>/packages/plugins/fake-plugin/package.json  (fake plugin)
 */
function makeTempRepo() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "link-plugin-dev-sdk-"));

  const sdkDir = path.join(tmpRoot, "packages", "plugins", "sdk");
  mkdirSync(sdkDir, { recursive: true });
  writeFileSync(path.join(sdkDir, "index.js"), "// sdk\n");

  const packageDir = path.join(tmpRoot, "packages", "plugins", "fake-plugin");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "package.json"), '{"name":"fake-plugin"}\n');

  return { tmpRoot, sdkDir, packageDir };
}

// ---------------------------------------------------------------------------
// Regression test: reproduces the Node >= 22/24 EEXIST crash.
//
// pnpm creates the workspace symlink BEFORE the postinstall script runs.
// The original rmSync(linkTarget, { force: true }) throws ERR_FS_EISDIR for
// a symlink-to-directory on Node >= 22/24.  The bare catch {} swallows it,
// leaving the symlink in place.  symlinkSync then throws EEXIST, aborting
// `pnpm install`.
// ---------------------------------------------------------------------------
test("linkPluginDevSdk: idempotent when pnpm has already created the workspace symlink (regression)", () => {
  const { tmpRoot, sdkDir, packageDir } = makeTempRepo();
  try {
    const scopeDir = path.join(packageDir, "node_modules", "@paperclipai");
    mkdirSync(scopeDir, { recursive: true });
    const linkTarget = path.join(scopeDir, "plugin-sdk");
    const relativeSdkDir = path.relative(scopeDir, sdkDir);

    // Simulate pnpm: create the workspace symlink first, before postinstall
    symlinkSync(relativeSdkDir, linkTarget, "dir");

    // Must NOT throw (was: EEXIST on Node >= 22/24)
    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });

    // Symlink must still point to sdkDir
    const stat = lstatSync(linkTarget);
    assert.ok(stat.isSymbolicLink(), "link should remain a symlink");
    assert.equal(
      path.resolve(scopeDir, readlinkSync(linkTarget)),
      sdkDir,
      "symlink should resolve to sdkDir",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Normal cases
// ---------------------------------------------------------------------------

test("linkPluginDevSdk: creates symlink when none exists", () => {
  const { tmpRoot, sdkDir, packageDir } = makeTempRepo();
  try {
    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });

    const scopeDir = path.join(packageDir, "node_modules", "@paperclipai");
    const linkTarget = path.join(scopeDir, "plugin-sdk");
    const stat = lstatSync(linkTarget);
    assert.ok(stat.isSymbolicLink(), "link target should be a symlink");
    assert.equal(
      path.resolve(scopeDir, readlinkSync(linkTarget)),
      sdkDir,
      "symlink should resolve to sdkDir",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("linkPluginDevSdk: idempotent when called twice with no pre-existing symlink", () => {
  const { tmpRoot, packageDir } = makeTempRepo();
  try {
    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });
    // Second call must not throw
    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("linkPluginDevSdk: replaces stale symlink pointing to wrong target", () => {
  const { tmpRoot, sdkDir, packageDir } = makeTempRepo();
  try {
    const scopeDir = path.join(packageDir, "node_modules", "@paperclipai");
    mkdirSync(scopeDir, { recursive: true });
    const linkTarget = path.join(scopeDir, "plugin-sdk");

    // Create a stale symlink pointing to a different directory
    const staleDir = path.join(tmpRoot, "stale-sdk");
    mkdirSync(staleDir, { recursive: true });
    symlinkSync(path.relative(scopeDir, staleDir), linkTarget, "dir");

    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });

    const stat = lstatSync(linkTarget);
    assert.ok(stat.isSymbolicLink(), "should be a symlink after replacement");
    assert.equal(
      path.resolve(scopeDir, readlinkSync(linkTarget)),
      sdkDir,
      "should now resolve to sdkDir",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("linkPluginDevSdk: leaves real (non-symlink) directory in place", () => {
  const { tmpRoot, packageDir } = makeTempRepo();
  try {
    const scopeDir = path.join(packageDir, "node_modules", "@paperclipai");
    const linkTarget = path.join(scopeDir, "plugin-sdk");
    mkdirSync(linkTarget, { recursive: true });
    writeFileSync(path.join(linkTarget, "real-file.js"), "// installed\n");

    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });

    const stat = lstatSync(linkTarget);
    assert.ok(!stat.isSymbolicLink(), "real directory must not be replaced");
    assert.ok(stat.isDirectory(), "must remain a directory");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("linkPluginDevSdk: sdk directory contents are preserved after link", () => {
  const { tmpRoot, sdkDir, packageDir } = makeTempRepo();
  try {
    const scopeDir = path.join(packageDir, "node_modules", "@paperclipai");
    mkdirSync(scopeDir, { recursive: true });
    const linkTarget = path.join(scopeDir, "plugin-sdk");
    const relativeSdkDir = path.relative(scopeDir, sdkDir);
    symlinkSync(relativeSdkDir, linkTarget, "dir");

    linkPluginDevSdk({ packageDir, repoRoot: tmpRoot });

    // The sdk sentinel file should be accessible through the symlink
    const sentinelContent = readFileSync(path.join(linkTarget, "index.js"), "utf8");
    assert.equal(sentinelContent, "// sdk\n", "sdk contents accessible through link");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
