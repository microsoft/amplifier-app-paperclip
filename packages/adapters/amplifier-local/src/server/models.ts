/**
 * Dynamic model discovery for amplifier-local.
 *
 * The amplifier-agent CLI exposes `models list` (no --provider flag) — an
 * aggregate discovery command that queries every known provider in parallel
 * and emits a per-provider results envelope. The TS wrapper exposes this as
 * `listAllModels()`. This file is the adapter-side adapter for that wrapper
 * function — it converts the engine's envelope into the `AdapterModel[]`
 * shape paperclip's UI expects, applies a short TTL cache to avoid hammering
 * the engine on every page load, and falls back to a static list when
 * discovery fails entirely.
 *
 * Design notes:
 *
 * - **Why aggregate (not 4 single-provider calls)**: one subprocess spawn
 *   instead of four. The engine parallelizes the provider queries internally.
 *   Per-provider auth status comes back as `status: "credentials_missing"`
 *   data in the envelope rather than as exceptions to catch — simpler error
 *   model on the consuming side.
 *
 * - **Why merge with static fallback**: a fresh paperclip install with no
 *   API keys configured produces an envelope where every provider has
 *   `status: "credentials_missing"` and `models: []`. The agent-creation
 *   form would show an empty dropdown — useless. Static fallback keeps the
 *   form populated with sensible defaults; discovered models override and
 *   extend the list as keys get configured.
 *
 * - **Why TTL cache (not API-key fingerprint)**: the aggregate call spans
 *   four providers, each with potentially different env-var keys
 *   (ANTHROPIC_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_API_KEY, etc.).
 *   Fingerprinting all of them would be brittle. A short TTL (60s) is the
 *   simplest invalidation strategy and matches claude-local's posture.
 *   Users who rotate keys can call `refreshAmplifierLocalModels()`
 *   explicitly via the UI's refresh button.
 *
 * - **Discovery failure ≠ crash**: if `listAllModels()` rejects (engine
 *   binary missing, subprocess timeout, malformed envelope), we log a
 *   warning and fall back to the static list. The agent-creation form must
 *   keep working even if the engine is misconfigured.
 */

import { listAllModels, ListModelsError } from "amplifier-agent-ts";
import type { AdapterModel } from "@paperclipai/adapter-utils";

import { models as DIRECT_MODELS } from "../index.js";

const CACHE_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 15_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const result: AdapterModel[] = [];
  for (const m of models) {
    const id = m.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label: m.label?.trim() || id });
  }
  return result;
}

async function loadAmplifierModels({
  forceRefresh = false,
}: { forceRefresh?: boolean } = {}): Promise<AdapterModel[]> {
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  let discovered: AdapterModel[] = [];
  try {
    const envelope = await listAllModels({
      env: process.env,
      timeoutMs: LIST_TIMEOUT_MS,
    });

    // Only surface providers that returned status: "ok". Other statuses
    // (credentials_missing, module_not_installed, error) imply the provider
    // isn't ready — surfacing its (possibly stale, possibly empty) model
    // list would be misleading.
    for (const result of envelope.results) {
      if (result.status !== "ok") continue;
      for (const m of result.models) {
        discovered.push({
          id: m.id,
          // ModelInfo.display_name is required on the wire but defensively
          // fall back to id if a future engine version relaxes it.
          label: m.display_name || m.id,
        });
      }
    }
  } catch (err) {
    // Engine-wide discovery failure (binary missing, exit 1/2, timeout,
    // malformed envelope). Log so operators see it, then fall back to the
    // static list so the agent-creation form keeps working.
    const reason =
      err instanceof ListModelsError
        ? `exitCode=${err.exitCode} stderr=${err.stderr.slice(0, 200)}`
        : err instanceof Error
          ? err.message
          : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      "[amplifier-local] listAllModels failed; using static fallback. " + reason,
    );
    discovered = [];
  }

  // Merge: discovered models first (so engine-truthful identifiers and
  // labels win), then static fallback fills in anything missing.
  const merged = dedupeModels([...discovered, ...DIRECT_MODELS]);
  cached = { expiresAt: Date.now() + CACHE_TTL_MS, models: merged };
  return merged;
}

/**
 * List available models, using a short TTL cache. Called by paperclip's
 * `/agents/<id>/models` route handler and the agent-creation form's initial
 * load. Safe to call frequently; the cache absorbs the cost.
 */
export async function listAmplifierLocalModels(): Promise<AdapterModel[]> {
  return loadAmplifierModels();
}

/**
 * Force-refresh the model cache, bypassing TTL. Called by paperclip's
 * `/agents/<id>/models/refresh` route handler when the user clicks the UI's
 * refresh button — typically after configuring new provider credentials.
 */
export async function refreshAmplifierLocalModels(): Promise<AdapterModel[]> {
  return loadAmplifierModels({ forceRefresh: true });
}

/**
 * Reset the in-memory cache. Test-only hook — production code should rely
 * on the natural TTL.
 */
export function resetAmplifierLocalModelsCacheForTests(): void {
  cached = null;
}
