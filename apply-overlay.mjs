#!/usr/bin/env node
/**
 * apply-overlay.mjs
 *
 * Idempotently applies the amplifier-local adapter overlay to a paperclip
 * clone at the pinned commit. Adds imports, adapter objects, registration
 * entries, and workspace deps for all three registry files + package.jsons.
 *
 * Usage: node apply-overlay.mjs <path-to-paperclip-dir>
 * Exit codes: 0 = success, 1 = error
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const paperclipDir = process.argv[2];
if (!paperclipDir) {
  console.error("ERROR: Usage: node apply-overlay.mjs <paperclip-dir>");
  process.exit(1);
}

let applied = 0;
let skipped = 0;

// ---------- helpers ----------

function read(relPath) {
  const full = join(paperclipDir, relPath);
  try {
    return { full, content: readFileSync(full, "utf8") };
  } catch (err) {
    console.error(`ERROR: Cannot read ${full}: ${err.message}`);
    process.exit(1);
  }
}

function write(full, content) {
  try {
    writeFileSync(full, content, "utf8");
  } catch (err) {
    console.error(`ERROR: Cannot write ${full}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Find the FIRST occurrence of `anchor` in `content` and insert `insertion`
 * immediately after it.  Throws if anchor is not found.
 */
function insertAfter(content, anchor, insertion) {
  const idx = content.indexOf(anchor);
  if (idx === -1) {
    const preview = anchor.slice(0, 80).replace(/\n/g, "\\n");
    throw new Error(`Anchor not found: "${preview}"`);
  }
  return (
    content.slice(0, idx + anchor.length) +
    insertion +
    content.slice(idx + anchor.length)
  );
}

/**
 * Apply one overlay to a TypeScript registry file.
 * `sentinel` is a string that, if present anywhere in the file, means the
 * overlay was already applied — skip silently.
 */
function applyTsOverlay(relPath, sentinel, applyFn) {
  const { full, content } = read(relPath);
  if (content.includes(sentinel)) {
    console.log(`  [skip]  ${relPath} (already applied)`);
    skipped++;
    return;
  }
  let patched;
  try {
    patched = applyFn(content);
  } catch (err) {
    console.error(`ERROR: ${relPath}: ${err.message}`);
    process.exit(1);
  }
  if (patched === content) {
    console.error(
      `ERROR: ${relPath}: overlay produced no change — anchor may have shifted`,
    );
    process.exit(1);
  }
  write(full, patched);
  console.log(`  [apply] ${relPath}`);
  applied++;
}

/**
 * Add "@paperclipai/adapter-amplifier-local": "workspace:*" to the
 * dependencies section of a package.json.  Preserves alphabetical order and
 * the existing 2-space indentation.
 */
function applyJsonDepOverlay(relPath) {
  const { full, content } = read(relPath);
  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch (err) {
    console.error(`ERROR: ${relPath}: JSON parse failed: ${err.message}`);
    process.exit(1);
  }
  if (pkg.dependencies?.["@paperclipai/adapter-amplifier-local"]) {
    console.log(`  [skip]  ${relPath} (already applied)`);
    skipped++;
    return;
  }
  const deps = pkg.dependencies ?? {};
  const newDeps = {};
  let inserted = false;
  for (const [k, v] of Object.entries(deps)) {
    if (!inserted && k > "@paperclipai/adapter-amplifier-local") {
      newDeps["@paperclipai/adapter-amplifier-local"] = "workspace:*";
      inserted = true;
    }
    newDeps[k] = v;
  }
  if (!inserted) {
    newDeps["@paperclipai/adapter-amplifier-local"] = "workspace:*";
  }
  pkg.dependencies = newDeps;
  write(full, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  [apply] ${relPath}`);
  applied++;
}

// ==========================================================================
// 1. server/src/adapters/registry.ts
//    Three insertions treated as a single overlay (sentinel: "amplifierLocalAdapter").
// ==========================================================================

applyTsOverlay(
  "server/src/adapters/registry.ts",
  "amplifierLocalAdapter",
  (c) => {
    // 1a. Insert amplifier-local imports right after the claude-local main imports.
    //     Anchor: the closing line of the claude-local main import block.
    c = insertAfter(
      c,
      '} from "@paperclipai/adapter-claude-local";',
      `
// === amplifier-local overlay ===
import {
  execute as amplifierExecute,
  testEnvironment as amplifierTestEnvironment,
  sessionCodec as amplifierSessionCodec,
} from "@paperclipai/adapter-amplifier-local/server";
import {
  agentConfigurationDoc as amplifierAgentConfigurationDoc,
  models as amplifierModels,
} from "@paperclipai/adapter-amplifier-local";`,
    );

    // 1b. Insert the amplifierLocalAdapter object right after the codexLocalAdapter
    //     object closes.  The unique closing lines of that object are used as anchor.
    c = insertAfter(
      c,
      "  getQuotaWindows: codexGetQuotaWindows,\n};",
      `

const amplifierLocalAdapter: ServerAdapterModule = {
  type: "amplifier_local",
  execute: amplifierExecute,
  testEnvironment: amplifierTestEnvironment,
  sessionCodec: amplifierSessionCodec,
  models: amplifierModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: amplifierAgentConfigurationDoc,
};`,
    );

    // 1c. Register amplifierLocalAdapter in registerBuiltInAdapters() after
    //     codexLocalAdapter.  Uses a two-line anchor to avoid false matches.
    c = insertAfter(
      c,
      "    claudeLocalAdapter,\n    codexLocalAdapter,",
      "\n    amplifierLocalAdapter,",
    );

    return c;
  },
);

// ==========================================================================
// 2. ui/src/adapters/registry.ts
//    Two insertions (import + registerBuiltInUIAdapters entry).
// ==========================================================================

applyTsOverlay(
  "ui/src/adapters/registry.ts",
  "amplifierLocalUIAdapter",
  (c) => {
    // 2a. Insert import after claudeLocalUIAdapter import line.
    c = insertAfter(
      c,
      'import { claudeLocalUIAdapter } from "./claude-local";',
      `\nimport { amplifierLocalUIAdapter } from "./amplifier-local";`,
    );

    // 2b. Insert into the registerBuiltInUIAdapters() array after claudeLocalUIAdapter.
    c = insertAfter(
      c,
      "    claudeLocalUIAdapter,",
      "\n    amplifierLocalUIAdapter,",
    );

    return c;
  },
);

// ==========================================================================
// 3. cli/src/adapters/registry.ts
//    Three insertions: import, object definition, Map entry.
// ==========================================================================

applyTsOverlay(
  "cli/src/adapters/registry.ts",
  "amplifierLocalCLIAdapter",
  (c) => {
    // 3a. Insert import after claude-local CLI import.
    c = insertAfter(
      c,
      'import { printClaudeStreamEvent } from "@paperclipai/adapter-claude-local/cli";',
      `\nimport { printAmplifierLocalStreamEvent } from "@paperclipai/adapter-amplifier-local/cli";`,
    );

    // 3b. Insert amplifierLocalCLIAdapter object right after claudeLocalCLIAdapter closes.
    //     The unique closing of that object (printClaudeStreamEvent) serves as anchor.
    c = insertAfter(
      c,
      "  formatStdoutEvent: printClaudeStreamEvent,\n};",
      `

const amplifierLocalCLIAdapter: CLIAdapterModule = {
  type: "amplifier_local",
  formatStdoutEvent: printAmplifierLocalStreamEvent,
};`,
    );

    // 3c. Insert into the Map after claudeLocalCLIAdapter.
    c = insertAfter(
      c,
      "    claudeLocalCLIAdapter,",
      "\n    amplifierLocalCLIAdapter,",
    );

    return c;
  },
);

// ==========================================================================
// 4-6. package.json files — add workspace dep
// ==========================================================================

applyJsonDepOverlay("server/package.json");
applyJsonDepOverlay("ui/package.json");
applyJsonDepOverlay("cli/package.json");

// ==========================================================================
// Summary
// ==========================================================================

console.log(
  `\nApplied ${applied} overlay(s), skipped ${skipped} (already applied).`,
);
