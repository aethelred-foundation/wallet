#!/usr/bin/env node
/**
 * Aethelred Wallet - dependency freshness report.
 *
 * For every direct dependency declared in the root `package.json`
 * (and each workspace package.json), queries the npm registry for the
 * latest version and computes how many major versions behind the
 * installed one is. Emits `reports/dep-freshness.json`.
 *
 * Complements Dependabot: Dependabot opens one PR per outdated dep,
 * which is noisy for a 200-dep tree. This gives a single summary JSON
 * that weekly cron can post to GitHub issues, showing the drift
 * distribution at a glance.
 *
 * Uses raw HTTP fetch against the public npm registry, no CLI
 * shell-out, keeping the script portable and fast.
 *
 * Exit codes:
 *   0 - report generated successfully
 *   1 - one or more deps are more than 1 major version behind (gate mode)
 *   2 - unrecoverable error (registry unreachable, invalid package.json)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const reportsDir = resolve(repoRoot, "reports");
const outputPath = resolve(reportsDir, "dep-freshness.json");

const STRICT_MAJOR_BEHIND = 1; // gate trips when major-delta > this
const args = new Set(process.argv.slice(2));
const shouldGate = args.has("--gate");
const includeInternal = args.has("--include-internal");
const registry = "https://registry.npmjs.org";

/**
 * Parse a semver-ish range/version to its "major" number. Handles
 * things like `^1.2.3`, `~1.2.3`, `>=1.2.3`, `1.2.3`, `1.2.x`, and
 * exact SHAs (returns null). We only care about the *major* for this
 * report - patch/minor drift isn't dangerous enough to flag weekly.
 */
function extractMajor(spec) {
  if (!spec) return null;
  if (/^(file:|link:|workspace:)/.test(spec)) return null;
  const match = /(\d+)\.\d+\.\d+/.exec(spec);
  if (!match) return null;
  return parseInt(match[1], 10);
}

async function fetchLatest(pkg) {
  const url = `${registry}/${encodeURIComponent(pkg).replace("%40", "@")}/latest`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return { version: body.version, time: body.time };
  } catch (err) {
    return { error: err.message };
  }
}

function gatherDirectDeps() {
  const allDeps = new Map();
  const manifests = [];

  // Root package.json (pinned tooling like Knip and sharp).
  const rootJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  manifests.push({ name: "@aethelred/wallet-local", json: rootJson });

  // Each workspace package.
  for (const root of ["packages", "apps"]) {
    const rootDir = resolve(repoRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(rootDir, entry.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      try {
        const json = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        manifests.push({ name: json.name, json });
      } catch {
        // skip malformed
      }
    }
  }

  for (const { name: owner, json } of manifests) {
    const sections = ["dependencies", "devDependencies", "peerDependencies"];
    for (const section of sections) {
      const deps = json[section] ?? {};
      for (const [name, spec] of Object.entries(deps)) {
        if (!includeInternal && name.startsWith("@aethelred/")) continue;
        if (!allDeps.has(name)) {
          allDeps.set(name, { spec, owners: new Set([owner]) });
        } else {
          allDeps.get(name).owners.add(owner);
        }
      }
    }
  }
  return allDeps;
}

async function main() {
  const direct = gatherDirectDeps();
  console.log(`Checking ${direct.size} direct dependencies against npm registry...`);

  const limit = 12; // max parallel requests - play nice with the registry
  const entries = [...direct.entries()];
  const results = [];
  for (let i = 0; i < entries.length; i += limit) {
    const batch = entries.slice(i, i + limit);
    const resolved = await Promise.all(
      batch.map(async ([name, info]) => {
        const latest = await fetchLatest(name);
        const installedMajor = extractMajor(info.spec);
        const latestMajor =
          latest.version != null ? extractMajor(latest.version) : null;
        const majorDelta =
          installedMajor != null && latestMajor != null
            ? Math.max(0, latestMajor - installedMajor)
            : null;
        return {
          name,
          installed: info.spec,
          installedMajor,
          latest: latest.version ?? null,
          latestMajor,
          majorDelta,
          error: latest.error ?? null,
          owners: [...info.owners].sort(),
        };
      }),
    );
    results.push(...resolved);
  }

  results.sort((a, b) => {
    const aD = a.majorDelta ?? -1;
    const bD = b.majorDelta ?? -1;
    if (aD !== bD) return bD - aD;
    return a.name.localeCompare(b.name);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totalDeps: results.length,
    missing: results.filter((r) => r.error || r.latest == null).length,
    drift: {
      atLatest: results.filter((r) => r.majorDelta === 0).length,
      oneMajorBehind: results.filter((r) => r.majorDelta === 1).length,
      manyMajorBehind: results.filter(
        (r) => r.majorDelta != null && r.majorDelta > 1,
      ).length,
    },
    deps: results,
  };

  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2) + "\n");

  console.log("");
  console.log(
    `At latest:         ${summary.drift.atLatest}/${summary.totalDeps}`,
  );
  console.log(
    `1 major behind:    ${summary.drift.oneMajorBehind}/${summary.totalDeps}`,
  );
  console.log(
    `>1 major behind:   ${summary.drift.manyMajorBehind}/${summary.totalDeps}`,
  );
  console.log(
    `Unreachable:       ${summary.missing}/${summary.totalDeps}`,
  );
  console.log(`Report: ${outputPath.replace(repoRoot + "/", "")}`);

  const stale = results.filter(
    (r) => r.majorDelta != null && r.majorDelta > STRICT_MAJOR_BEHIND,
  );
  if (stale.length > 0) {
    console.log("");
    console.log(`Deps more than ${STRICT_MAJOR_BEHIND} major version behind:`);
    for (const r of stale) {
      console.log(
        `  ${r.name}: ${r.installed} (installed major ${r.installedMajor}) -> ${r.latest} (latest major ${r.latestMajor})`,
      );
    }
    if (shouldGate) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
