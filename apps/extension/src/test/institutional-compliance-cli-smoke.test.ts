/**
 * Subprocess smoke test for the institutional-compliance-demo CLI.
 *
 * The CLI is sugar around `runInstitutionalComplianceDemo` (PR #167)
 * — the runner has 8 logic tests in
 * `institutional-compliance-demo.test.ts`. This file pins the
 * **operational contract** of the binary itself:
 *
 *   - Exit code 0 in each of the three documented modes (happy /
 *     deny / mixed)
 *   - --json produces output that round-trips through `JSON.parse`
 *   - --prom output contains the expected Prometheus metric names
 *   - --help mentions every flag documented in the binary's help
 *     text (regression guard for "I forgot to document the new flag")
 *
 * These are the things a CI smoke test cares about. We do NOT
 * verify the ANSI formatting of the default output — that's
 * cosmetic and would break this test on every visual tweak.
 *
 * Spawning tsx via `spawnSync` is slower than in-process testing
 * (~500ms-1s cold start per test) but it's the only way to verify
 * the binary's exit-code contract end-to-end. The exit code 2 path
 * (auditChainValid=false) is unreachable from production code by
 * design and isn't covered here — closing that gap would require
 * dependency-injecting a "corrupt the chain" hook into the runner.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Resolve the workspace root from this test's location:
// apps/extension/src/test/<file>.ts → workspace root = ../../../..
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const TSX_BIN = path.join(WORKSPACE_ROOT, "node_modules/.bin/tsx");
const CLI_PATH = path.join(
  WORKSPACE_ROOT,
  "packages/integration/bin/aethelred-institutional-compliance-demo.ts",
);

// Generous timeout — cold tsx startup + module resolution + 2 sample
// txs is ~1-2s on a warm laptop. CI runners are slower.
const TEST_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_MS = 20_000;

function runCli(args: ReadonlyArray<string>): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd: WORKSPACE_ROOT,
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8",
    env: {
      ...process.env,
      // Force ANSI off so output is deterministic across terminals
      // / CI runners. Default-mode output uses ANSI but the smoke
      // test never inspects it.
      NO_COLOR: "1",
    },
  });
  // `spawnSync` returns null exitCode if killed by signal/timeout.
  // Surface that as a distinct value so the assertion message
  // shows what went wrong.
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ─── Exit-code contract ────────────────────────────────────────────

describe("CLI exit-code contract", () => {
  it("happy mode + --quiet → exit 0", () => {
    const r = runCli(["--mode", "happy", "--samples", "2", "--quiet"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
  }, TEST_TIMEOUT_MS);

  it(
    "deny mode + --quiet → STILL exit 0 (audit chain valid even when every attestation fails)",
    () => {
      // This is the most important assertion in the file: the
      // suppression-defense property is operationally visible
      // through the binary. A future refactor that breaks the chain
      // when liabilityUnknown=true would surface here.
      const r = runCli(["--mode", "deny", "--samples", "2", "--quiet"]);
      expect(r.exitCode, r.stderr).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it("mixed mode + --quiet → exit 0", () => {
    const r = runCli(["--mode", "mixed", "--samples", "5", "--quiet"]);
    expect(r.exitCode, r.stderr).toBe(0);
  }, TEST_TIMEOUT_MS);
});

// ─── --json contract ──────────────────────────────────────────────

describe("CLI --json contract", () => {
  it("produces a valid JSON object with documented top-level keys", () => {
    const r = runCli(["--json", "--mode", "happy", "--samples", "2"]);
    expect(r.exitCode, r.stderr).toBe(0);
    // Should round-trip through JSON.parse.
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe("happy");
    expect(parsed.auditChainValid).toBe(true);
    expect(parsed.auditEventCount).toBe(4); // 2 events per tx
    expect(parsed.liabilityStats.unknownRate).toBe(0);
    expect(Array.isArray(parsed.transactions)).toBe(true);
    expect(parsed.transactions).toHaveLength(2);
    // The matrix digest is the auditor's anchor — must be a hex
    // string with 0x prefix. Without this, downstream evidence
    // tooling that types-as-hex would silently break.
    expect(parsed.transactions[0].resolutionDigest).toMatch(/^0x[0-9a-f]+$/);
  }, TEST_TIMEOUT_MS);

  it(
    "deny mode JSON: unknownRate=1, latestCoverage=null, auditChainValid still true",
    () => {
      const r = runCli(["--json", "--mode", "deny", "--samples", "3"]);
      expect(r.exitCode, r.stderr).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.mode).toBe("deny");
      expect(parsed.liabilityStats.unknownRate).toBe(1);
      // latestCoverage is null when no known attestation ever landed.
      // The CLI serializes the bigint as null (not undefined) so
      // downstream JSON consumers don't choke on missing keys.
      expect(parsed.liabilityStats.latestCoverage).toBeNull();
      expect(parsed.auditChainValid).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

// ─── --prom contract ─────────────────────────────────────────────

describe("CLI --prom contract", () => {
  it("emits Prometheus text format with the documented metric names", () => {
    const r = runCli(["--prom", "--mode", "happy", "--samples", "3"]);
    expect(r.exitCode, r.stderr).toBe(0);
    // The seven gauges + two counters from PR #165's exportToMeter
    // must all appear. If a future refactor renames a metric, this
    // test fails — operators alerting on the old name would break.
    const expectedMetrics = [
      "custodian_liability_window_total",
      "custodian_liability_window_known_count",
      "custodian_liability_window_unknown_count",
      "custodian_liability_unknown_rate",
      "custodian_liability_window_status_count",
      "custodian_liability_latest_coverage",
      "custodian_liability_attestations_total",
      "custodian_liability_status_total",
    ];
    for (const metric of expectedMetrics) {
      expect(r.stdout).toContain(metric);
    }
    // Per-status label dimension present.
    expect(r.stdout).toContain('status="operational"');
  }, TEST_TIMEOUT_MS);
});

// ─── --help contract ──────────────────────────────────────────────

describe("CLI --help contract", () => {
  it("help text mentions every documented flag (regression guard)", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode, r.stderr).toBe(0);
    // Every flag the CLI accepts should appear in --help — this is
    // the "I forgot to document the new flag" regression guard.
    const expectedFlags = [
      "--json",
      "--quiet",
      "--prom",
      "--mode",
      "--samples",
      "--tenant-id",
      "--help",
    ];
    for (const flag of expectedFlags) {
      expect(r.stdout).toContain(flag);
    }
    // Exit-code documentation must surface the three semantic codes.
    expect(r.stdout).toContain("0");
    expect(r.stdout).toContain("1");
    expect(r.stdout).toContain("2");
  }, TEST_TIMEOUT_MS);

  it("--help short form (-h) works identically", () => {
    const long = runCli(["--help"]);
    const short = runCli(["-h"]);
    expect(short.exitCode).toBe(0);
    expect(short.stdout).toBe(long.stdout);
  }, TEST_TIMEOUT_MS);
});

// ─── --tenant-id passthrough ─────────────────────────────────────

describe("CLI --tenant-id passthrough", () => {
  it("custom tenant id surfaces in --json output", () => {
    const r = runCli([
      "--json",
      "--mode",
      "happy",
      "--samples",
      "1",
      "--tenant-id",
      "acme-bank-uae",
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.tenantId).toBe("acme-bank-uae");
  }, TEST_TIMEOUT_MS);
});
