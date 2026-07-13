/**
 * testEnvironment — preflight checks for amplifier-local.
 *
 * Runs in the paperclip UI when an operator clicks "Test environment" on an
 * agent. Validates:
 *   1. cwd exists and is a directory
 *   2. The configured command (default "amplifier-agent") is resolvable on PATH
 *   3. `amplifier-agent doctor` runs cleanly (and includes the G4 mcp-importable check)
 *   4. Credentials for the model's derived provider resolve, per
 *      `amplifier-agent providers list --json` (the CLI-visible view of the
 *      same converged credential resolver `run`/`serve` use — env var OR
 *      `~/.amplifier-agent/credentials.json` via `amplifier-agent auth set`)
 *
 * Status mapping:
 *   - any `error` check  → "fail" (blocks the agent from running)
 *   - any `warn` check   → "warn" (visible in UI, doesn't block)
 *   - all `info`         → "pass"
 */

import { promisify } from "node:util";
import { execFile as _execFile } from "node:child_process";

import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  ensureAbsoluteDirectory,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";

import { DEFAULT_AMPLIFIER_LOCAL_MODEL, SANDBOX_INSTALL_COMMAND } from "../index.js";
import { resolveProvider } from "./execute.js";

const execFile = promisify(_execFile);

const DOCTOR_TIMEOUT_MS = 30_000;

function summarizeStatus(checks: AdapterEnvironmentCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

function info(code: string, message: string, hint?: string): AdapterEnvironmentCheck {
  return { code, level: "info", message, ...(hint ? { hint } : {}) };
}
function warn(code: string, message: string, hint?: string): AdapterEnvironmentCheck {
  return { code, level: "warn", message, ...(hint ? { hint } : {}) };
}
function error(code: string, message: string, hint?: string): AdapterEnvironmentCheck {
  return { code, level: "error", message, ...(hint ? { hint } : {}) };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkCwd(cwd: string): Promise<AdapterEnvironmentCheck> {
  if (!cwd) {
    return info("amplifier_cwd_default", "cwd: <process default> (none configured)");
  }
  try {
    await ensureAbsoluteDirectory(cwd);
    return info("amplifier_cwd_valid", `cwd: ${cwd} (exists)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error("amplifier_cwd_invalid", `cwd invalid: ${msg}`, `Create ${cwd} or update the agent's cwd setting.`);
  }
}

async function checkCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<AdapterEnvironmentCheck> {
  // Resolve via `command -v` (POSIX) or the equivalent. Avoids a dependency
  // on platform-specific tooling.
  try {
    const probe = await execFile(
      "/bin/sh",
      ["-c", `command -v "${command.replace(/"/g, '\\"')}"`],
      { cwd: cwd || process.cwd(), env, timeout: 5_000, maxBuffer: 64 * 1024 },
    );
    const resolved = probe.stdout.trim();
    if (resolved) {
      return info("amplifier_command_resolvable", `command: ${resolved}`);
    }
    return error(
      "amplifier_command_unresolvable",
      `"${command}" not found in PATH`,
      `Install amplifier-agent: ${SANDBOX_INSTALL_COMMAND}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error(
      "amplifier_command_unresolvable",
      `Cannot resolve "${command}" in PATH: ${msg}`,
      `Install amplifier-agent: ${SANDBOX_INSTALL_COMMAND}`,
    );
  }
}

async function checkDoctor(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<AdapterEnvironmentCheck[]> {
  if (command !== "amplifier-agent") {
    return [
      info(
        "amplifier_doctor_skipped_custom_command",
        `doctor probe skipped (custom command: ${command})`,
        "Set command to 'amplifier-agent' to run the built-in doctor.",
      ),
    ];
  }
  try {
    const { stdout, stderr } = await execFile(command, ["doctor"], {
      cwd: cwd || process.cwd(),
      env,
      timeout: DOCTOR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const output = `${stdout}\n${stderr}`;
    const checks: AdapterEnvironmentCheck[] = [];
    checks.push(info("amplifier_doctor_passed", "amplifier-agent doctor: all checks passed"));

    // Surface the mcp-importable check status separately so the UI shows the
    // G4 result explicitly (engine PR #34 added this check).
    if (/\[\s*OK\s*\]\s*mcp module:/.test(output)) {
      checks.push(info("amplifier_mcp_importable", "mcp Python package: importable"));
    } else if (/mcp module/.test(output)) {
      // The doctor reported on tool-mcp but not with OK — surface as warn.
      checks.push(
        warn(
          "amplifier_mcp_check_indeterminate",
          "amplifier-agent doctor mentioned the mcp module but didn't report [OK]",
          "Run `amplifier-agent doctor` manually to see the full report.",
        ),
      );
    }
    return checks;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; signal?: string };
    if (e.code === "ETIMEDOUT" || e.signal === "SIGTERM") {
      return [
        warn(
          "amplifier_doctor_timed_out",
          `amplifier-agent doctor did not return within ${DOCTOR_TIMEOUT_MS / 1000}s`,
          "The doctor probe may be slow on first run (bundle preparation). Try again or run it manually.",
        ),
      ];
    }
    const stderr = (e.stderr ?? "").toString().trim();
    const stdout = (e.stdout ?? "").toString().trim();
    const detail = [stderr, stdout].filter(Boolean).join("\n") || e.message;
    return [
      error(
        "amplifier_doctor_failed",
        `amplifier-agent doctor reported a failure: ${detail.split("\n")[0]}`,
        "Run `amplifier-agent doctor` manually for the full report. If the bundle cache is stale, try `amplifier-agent cache clear` and re-run.",
      ),
    ];
  }
}

/**
 * Row shape from `amplifier-agent providers list --json` (schema_version 1).
 * We only read the fields we display; anything else on the row is ignored.
 */
interface ProvidersListRow {
  name?: unknown;
  resolvable?: unknown;
  source?: unknown;
  env_var?: unknown;
}

/**
 * Ask amplifier-agent itself whether the agent's derived provider has
 * resolvable credentials (env var, or `~/.amplifier-agent/credentials.json`
 * via `amplifier-agent auth set`). This is the same converged resolver that
 * `run` / `serve` auto-enable use — the adapter no longer inspects env vars
 * itself, since amplifier-agent post-Phase-1 is the single source of truth
 * for "does this provider have credentials".
 */
async function checkProviderResolvable(
  command: string,
  cwd: string,
  env: Record<string, string>,
  model: string,
  explicitProvider: string,
): Promise<AdapterEnvironmentCheck> {
  const provider = resolveProvider(explicitProvider, model);
  if (command !== "amplifier-agent") {
    return info(
      "amplifier_provider_check_skipped_custom_command",
      `provider credential check skipped (custom command: ${command})`,
      "Set command to 'amplifier-agent' to run the built-in provider check.",
    );
  }
  let rows: ProvidersListRow[];
  try {
    const { stdout } = await execFile(command, ["providers", "list", "--json"], {
      cwd: cwd || process.cwd(),
      env,
      timeout: DOCTOR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const parsed: unknown = JSON.parse(stdout);
    const list = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).providers : undefined;
    rows = Array.isArray(list) ? (list as ProvidersListRow[]) : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(
      "amplifier_provider_check_indeterminate",
      `Could not run "amplifier-agent providers list --json": ${msg}`,
      "Run `amplifier-agent providers list` manually, or upgrade amplifier-agent if this command is unavailable.",
    );
  }
  const row = rows.find((r) => asString(r.name, "") === provider);
  if (!row) {
    return warn(
      "amplifier_provider_unknown",
      `amplifier-agent does not report a "${provider}" provider`,
      "Check the model's derived provider against `amplifier-agent providers list`.",
    );
  }
  const envVar = asString(row.env_var, "");
  if (row.resolvable === true) {
    const source = asString(row.source, "unknown");
    return info(
      "amplifier_provider_key_present",
      `${provider}: credentials resolvable (source: ${source}${envVar ? `, ${envVar}` : ""})`,
    );
  }
  return warn(
    "amplifier_provider_key_missing",
    `${provider}: credentials not resolvable${envVar ? ` (checked ${envVar})` : ""}`,
    `Run \`amplifier-agent auth set ${provider} <key>\` on the host, or set ${envVar || "the provider's API key"} in the agent's env config.`,
  );
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const command = asString(config.command, "amplifier-agent");
  const cwd = asString(config.cwd, "");
  const model = asString(config.model, DEFAULT_AMPLIFIER_LOCAL_MODEL);
  const explicitProvider = asString(config.provider, "");
  const envConfig = parseObject(config.env);

  // Build the env for command resolution. Use the host env as the base (so
  // PATH is present) and let user env override.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }

  const checks: AdapterEnvironmentCheck[] = [];
  checks.push(await checkCwd(cwd));
  checks.push(await checkCommand(command, cwd, env));

  // Only run doctor if the command was resolvable — otherwise it'll just
  // produce a redundant failure.
  const commandResolvable = checks.some(
    (c) => c.code === "amplifier_command_resolvable",
  );
  if (commandResolvable) {
    checks.push(...(await checkDoctor(command, cwd, env)));
    checks.push(await checkProviderResolvable(command, cwd, env, model, explicitProvider));
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
