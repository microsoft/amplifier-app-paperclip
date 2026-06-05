/**
 * Tests for inheritProviderKeysFromHostEnv — the whitelist-based mechanism
 * that lets amplifier-local agents pick up provider API keys from the
 * paperclip server's host environment when the per-agent config.env does
 * not set them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_ENV_VARS,
  inheritProviderKeysFromHostEnv,
} from "../server/execute.js";

type LogEntry = { channel: "stdout" | "stderr"; chunk: string };

function makeLogger(): { onLog: (c: "stdout" | "stderr", s: string) => Promise<void>; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    onLog: async (channel, chunk) => {
      entries.push({ channel, chunk });
    },
  };
}

describe("PROVIDER_ENV_VARS whitelist", () => {
  it("contains the documented provider keys", () => {
    // Each of these is referenced in the adapter's index.ts docs; the
    // whitelist must stay in sync.
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
      "GEMINI_API_KEY",
      "OLLAMA_HOST",
    ]) {
      expect(PROVIDER_ENV_VARS.has(key)).toBe(true);
    }
  });

  it("does NOT contain arbitrary host env vars (security)", () => {
    for (const key of ["DATABASE_URL", "PATH", "HOME", "AWS_SECRET_ACCESS_KEY"]) {
      expect(PROVIDER_ENV_VARS.has(key)).toBe(false);
    }
  });
});

describe("inheritProviderKeysFromHostEnv", () => {
  let env: Record<string, string>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    env = {};
    logger = makeLogger();
  });

  it("inherits whitelisted keys from host env when envConfig is empty", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      { ANTHROPIC_API_KEY: "sk-host-anthropic-123" } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.ANTHROPIC_API_KEY).toBe("sk-host-anthropic-123");
    expect(logger.entries).toContainEqual({
      channel: "stdout",
      chunk: "[paperclip] Inherited ANTHROPIC_API_KEY from host environment\n",
    });
  });

  it("does NOT overwrite when envConfig already set the key (per-agent wins)", async () => {
    env.ANTHROPIC_API_KEY = "sk-pre-existing";
    await inheritProviderKeysFromHostEnv(
      env,
      { ANTHROPIC_API_KEY: "sk-from-config" },
      { ANTHROPIC_API_KEY: "sk-host-should-be-ignored" } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    // envConfig contained the key, so the function must not touch env
    expect(env.ANTHROPIC_API_KEY).toBe("sk-pre-existing");
    // No log line because nothing was inherited
    expect(logger.entries).toHaveLength(0);
  });

  it("inherits one key but not another (mixed scenario)", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      { OPENAI_API_KEY: "sk-openai-from-config" },
      {
        ANTHROPIC_API_KEY: "sk-anthropic-from-host",
        OPENAI_API_KEY: "sk-openai-from-host-ignored",
      } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    // Anthropic comes from host (no envConfig); OpenAI is left for layerUserEnv
    expect(env.ANTHROPIC_API_KEY).toBe("sk-anthropic-from-host");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.chunk).toContain("ANTHROPIC_API_KEY");
  });

  it("does NOT inherit non-whitelisted host env vars (security)", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      {
        DATABASE_URL: "postgres://leaked",
        AWS_SECRET_ACCESS_KEY: "leaked",
        PATH: "/usr/bin:/bin",
      } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.PATH).toBeUndefined();
    expect(logger.entries).toHaveLength(0);
  });

  it("does NOT inherit when host env has an empty-string value", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      { ANTHROPIC_API_KEY: "" } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(logger.entries).toHaveLength(0);
  });

  it("does NOT inherit when host env is missing the key entirely", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      {} as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(logger.entries).toHaveLength(0);
  });

  it("treats envConfig key with empty-string value as 'configured' (per-agent intent wins)", async () => {
    // An operator who explicitly sets ANTHROPIC_API_KEY: "" in envConfig is
    // signalling 'don't use a key for this agent' — host inheritance must
    // respect that signal, not silently override.
    await inheritProviderKeysFromHostEnv(
      env,
      { ANTHROPIC_API_KEY: "" },
      { ANTHROPIC_API_KEY: "sk-host-would-overwrite" } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(logger.entries).toHaveLength(0);
  });

  it("works without an onLog callback (optional)", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      { OPENAI_API_KEY: "sk-openai-host" } as NodeJS.ProcessEnv,
    );
    expect(env.OPENAI_API_KEY).toBe("sk-openai-host");
  });

  it("inherits multiple whitelisted keys in one call", async () => {
    await inheritProviderKeysFromHostEnv(
      env,
      {},
      {
        ANTHROPIC_API_KEY: "sk-a",
        OPENAI_API_KEY: "sk-b",
        AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
        OLLAMA_HOST: "http://localhost:11434",
      } as NodeJS.ProcessEnv,
      logger.onLog,
    );
    expect(env.ANTHROPIC_API_KEY).toBe("sk-a");
    expect(env.OPENAI_API_KEY).toBe("sk-b");
    expect(env.AZURE_OPENAI_ENDPOINT).toBe("https://example.openai.azure.com");
    expect(env.OLLAMA_HOST).toBe("http://localhost:11434");
    expect(logger.entries).toHaveLength(4);
  });
});
