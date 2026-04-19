/**
 * Deterministic packaging regression test.
 *
 * Running `node scripts/package-extension.mjs` back-to-back on the same
 * commit must produce byte-identical Chrome Web Store ZIPs. Supply-chain
 * auditors rely on this to verify the bytes we publish to CWS match the
 * bytes in the tagged git SHA.
 *
 * The test is intentionally slow (~60s — it runs the packaging pipeline
 * twice, which includes a full Vite production build each time) so it
 * lives in its own file and is easy to skip locally via `vitest run
 * --exclude "**\/deterministic-build.test.ts"` when iterating on something
 * else.
 *
 * Why a full re-build on each invocation rather than just re-zipping an
 * existing dist/? The most common determinism regressions we've seen
 * come from Vite / Rollup / tsc embedding timestamps or absolute paths
 * into their output. Zipping the same dist/ twice would only catch
 * determinism bugs in the ZIP writer itself — missing the bigger class
 * of bugs. Doing a fresh build each run means any non-determinism that
 * creeps into the pipeline (at any layer) fails this test.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const SCRIPT = resolve(REPO_ROOT, "scripts", "package-extension.mjs");

/**
 * Execute the packaging script once. Throws if it exits non-zero so the
 * test fails with the script's stderr surfaced in the report.
 */
function runPackageScript(): void {
  const result = spawnSync("node", [SCRIPT], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `package-extension.mjs exited with ${result.status}\n`
        + `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
  }
}

/**
 * SHA-256 of a file on disk as a hex string.
 */
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("deterministic extension packaging", () => {
  // 4 minutes: Vite + zip + Vite + zip, on a warm npm cache.
  it(
    "produces byte-identical ZIPs on two consecutive runs",
    { timeout: 240_000 },
    () => {
      const versionManifest = JSON.parse(
        readFileSync(
          resolve(REPO_ROOT, "apps", "extension", "public", "manifest.json"),
          "utf8",
        ),
      ) as { version: string };
      const zipPath = resolve(
        REPO_ROOT,
        "releases",
        `aethelred-wallet-v${versionManifest.version}.zip`,
      );

      runPackageScript();
      expect(existsSync(zipPath)).toBe(true);
      const firstHash = sha256(zipPath);

      runPackageScript();
      expect(existsSync(zipPath)).toBe(true);
      const secondHash = sha256(zipPath);

      // A matching hash across two back-to-back builds is the explicit
      // contract of `scripts/package-extension.mjs` and the one the CI
      // release job gates on. If this fails, something in the build
      // pipeline (Vite config, a plugin, the ZIP writer, ...) has
      // acquired a dependency on wall-clock time, random seeding, or
      // filesystem traversal order. Fix the pipeline — do not update
      // the expected value here.
      expect(secondHash).toBe(firstHash);
    },
  );
});
