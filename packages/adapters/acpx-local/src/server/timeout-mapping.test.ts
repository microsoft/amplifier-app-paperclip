/**
 * Unit tests for the timeoutSecToMs helper in server/execute.ts.
 *
 * Regression guard: previously the adapter passed `undefined` for the
 * no-timeout case, leaving downstream ACPX runtime calls with an absent
 * timeoutMs field.  After the fix the adapter always passes an explicit 0
 * so the "no timeout" intent is unambiguous at every call site.
 */

import { describe, expect, it } from "vitest";
import { timeoutSecToMs } from "./execute.js";

describe("timeoutSecToMs (acpx-local)", () => {
  it("returns 0 for timeoutSec = 0 (no-timeout explicit disabled signal)", () => {
    expect(timeoutSecToMs(0)).toBe(0);
  });

  it("returns 0 for timeoutSec < 0 (also treated as no timeout)", () => {
    expect(timeoutSecToMs(-1)).toBe(0);
  });

  it("converts 1800 seconds to 1800000 ms (30 min)", () => {
    expect(timeoutSecToMs(1800)).toBe(1800000);
  });

  it("converts 7200 seconds to 7200000 ms (2 h)", () => {
    expect(timeoutSecToMs(7200)).toBe(7200000);
  });
});
