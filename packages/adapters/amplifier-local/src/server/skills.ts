/**
 * Skill introspection for amplifier-local.
 *
 * amplifier-local materializes its desired skills *ephemerally* into the
 * per-company skills dir on every spawn (see execute.ts's materialization
 * loop, which emits `[paperclip] Materialized amplifier-local skill "X" into
 * …/amplifier-local/skills`). Unlike claude-local — which writes into a
 * stable user-wide `~/.claude/skills/` — amplifier-local has nothing
 * meaningful to inspect *between* runs; the dir is rewritten on every spawn.
 *
 * Despite that, the UI's skills tab wants a "here's what is configured"
 * snapshot so users can see what *would* be materialized on the next run.
 * That's exactly what `buildRuntimeMountedSkillSnapshot` produces with
 * `mode: "ephemeral"` — the entry list is the available-skill set filtered
 * by the desired-skill preference.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildRuntimeMountedSkillSnapshot,
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

import {
  resolveAmplifierLocalManagedDir,
  resolveSkillsDir,
} from "./amplifier-host-config.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAmplifierLocalSkillSnapshot(
  companyId: string,
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  // Resolve the per-company target dir where execute.ts materializes skills
  // at spawn time. We surface it as `skillsHome` so the UI can show the
  // materialization target (helpful when debugging "where did my skill go?").
  const managedDir = resolveAmplifierLocalManagedDir(process.env, companyId);
  const skillsHome = resolveSkillsDir(managedDir);
  return buildRuntimeMountedSkillSnapshot({
    adapterType: "amplifier_local",
    mode: "ephemeral",
    availableEntries,
    desiredSkills,
    configuredDetail:
      "Will be materialized into the company-managed amplifier-local skills directory at the start of the next run.",
    skillsHome,
  });
}

export async function listAmplifierLocalSkills(
  ctx: AdapterSkillContext,
): Promise<AdapterSkillSnapshot> {
  return buildAmplifierLocalSkillSnapshot(ctx.companyId, ctx.config);
}

/**
 * Skill sync for amplifier-local is a no-op on the I/O side — there's no
 * persistent installation target to mutate. The set of desired skills lives
 * on the agent's adapterConfig (`paperclipDesiredSkills` etc.); the route
 * handler in server/src/routes/agents.ts:1505 has already updated that
 * config by the time it calls this function, then asks us for a fresh
 * snapshot to render. So we just re-read and return the current state.
 */
export async function syncAmplifierLocalSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildAmplifierLocalSkillSnapshot(ctx.companyId, ctx.config);
}
