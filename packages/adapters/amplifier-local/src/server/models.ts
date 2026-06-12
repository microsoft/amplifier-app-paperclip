/**
 * Dynamic model discovery for amplifier-local.
 *
 * The amplifier-agent CLI exposes `models list` (no --provider flag) — an
 * aggregate discovery command that queries every known provider in parallel
 * and emits a per-provider results envelope. The TS wrapper exposes this as
 * `listAllModels()`. This file is the adapter-side adapter for that wrapper
 * function — it converts the engine's envelope into the `AdapterModel[]`
 * shape paperclip's UI expects and applies a short TTL cache to avoid
 * hammering the engine on every page load.
 *
 * Design notes:
 *
 * - **No static fallback.** Earlier revisions of this file merged the
 *   discovered list with a hardcoded `DIRECT_MODELS` array shipped in the
 *   adapter source. That pattern is gone: the engine is the single source
 *   of truth for what models exist. If the engine reports nothing, the UI
 *   shows nothing — accurate (no engine-installed providers can authenticate)
 *   beats convenient-but-misleading.
 *
 * - **No failure swallowing.** When `listAllModels()` rejects (engine
 *   binary missing, subprocess timeout, malformed envelope, exit 1/2),
 *   the rejection propagates to the HTTP route handler. The UI sees an
 *   error, not a silently-served stale list. Misconfigured engines should
 *   announce themselves loudly, not hide behind cached statics.
 *
 * - **Why aggregate (not 4 single-provider calls)**: one subprocess spawn
 *   instead of four. The engine parallelizes the provider queries
 *   internally. Per-provider auth status comes back as
 *   `status: "credentials_missing"` data in the envelope rather than as
 *   exceptions to catch — simpler error model on the consuming side.
 *
 * - **TTL cache, no key fingerprint**: the aggregate call spans four
 *   providers, each with potentially different env-var keys
 *   (ANTHROPIC_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_API_KEY, etc.).
 *   Fingerprinting all of them would be brittle. A short TTL (60s) is the
 *   simplest invalidation strategy. Users who rotate keys can call
 *   `refreshAmplifierLocalModels()` explicitly via the UI's refresh button.
 *   We do NOT cache failures — next call retries.
 */

import { listAllModels } from "amplifier-agent-ts";
import type { AdapterModel } from "@paperclipai/adapter-utils";

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

  // No try/catch wrapping listAllModels(): failures propagate to the route
  // handler so misconfigured engines (binary missing, exit 1/2, timeout,
  // malformed envelope) surface to the UI rather than getting silently
  // smoothed over with a stale or fabricated list.
  const envelope = await listAllModels({
    env: process.env,
    timeoutMs: LIST_TIMEOUT_MS,
  });

  // Only surface providers that returned status: "ok". Other statuses
  // (credentials_missing, module_not_installed, error) imply the provider
  // isn't ready — surfacing its (empty or possibly stale) model list would
  // mislead the user about what's actually available right now.
  const discovered: AdapterModel[] = [];
  for (const result of envelope.results) {
    if (result.status !== "ok") continue;
    for (const m of result.models) {
      discovered.push({
        id: m.id,
        // ModelInfo.display_name is required on the wire; fall back to id
        // defensively if a future engine version relaxes it.
        label: m.display_name || m.id,
      });
    }
  }

  const deduped = dedupeModels(discovered);
  // Only cache successful results. If discovery rejected above, the catch
  // path in our caller logs and reports the failure; we leave `cached`
  // untouched so the next call retries against the live engine.
  cached = { expiresAt: Date.now() + CACHE_TTL_MS, models: deduped };
  return deduped;
}

/**
 * List available models, using a short TTL cache. Called by paperclip's
 * `/agents/<id>/models` route handler and the agent-creation form's initial
 * load. Rejects on engine discovery failure — there is no static fallback.
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
