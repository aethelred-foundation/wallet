#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * bundle-diff.mjs — local bundle delta vs a git ref
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Developer utility for validating bundle impact BEFORE opening a PR.
 *
 *   node scripts/bundle-diff.mjs main        # diff current vs main
 *   node scripts/bundle-diff.mjs HEAD~1      # diff current vs previous commit
 *
 * Workflow
 * --------
 *   1. Builds the current working tree; captures a manifest.
 *   2. Stashes any uncommitted changes.
 *   3. Checks out the target ref in detached-HEAD mode.
 *   4. Builds; captures a second manifest (this becomes the "baseline"
 *      for the comparison).
 *   5. Restores HEAD and unstashes.
 *   6. Runs `compareBundle()` on (target-ref, current) and prints the
 *      markdown report.
 *
 * Safety
 * ------
 *   • The script is a no-op if the working tree has unstaged files that
 *     would collide with the target-ref checkout unless `--force` is
 *     passed. The default posture is refuse-to-clobber.
 *   • `git stash pop` runs unconditionally in the cleanup block, so a
 *     failed build does not leave your work orphaned in a stash entry.
 *   • ALL git / npm invocations go through `execFileSync` with a fixed
 *     argv — no shell interpolation of user input.
 *
 * This script does NOT touch `reports/bundle-baseline.json`; it only
 * reads the current `dist/` snapshot at each ref and compares in memory.
 *
 * Owner: wallet-extension team. See docs/engineering/BUNDLE_BUDGETS.md §5.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  generateBundleManifest,
} from "./generate-bundle-manifest.mjs";
import { compareBundle, renderMarkdown } from "./compare-bundle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DIST_DIR = resolve(REPO_ROOT, "apps", "extension", "dist");

/** Run a command with a fixed argv array. Throws on non-zero exit. */
function run(cmd, args, extra = {}) {
  return execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: extra.silent ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
}

/** Capture git's current state so we can restore it if anything fails. */
function readCurrentRef() {
  try {
    const branch = run("git", ["symbolic-ref", "--short", "HEAD"], { silent: true }).trim();
    if (branch) return { kind: "branch", ref: branch };
  } catch {
    // detached HEAD — fall through
  }
  const sha = run("git", ["rev-parse", "HEAD"], { silent: true }).trim();
  return { kind: "detached", ref: sha };
}

/** Are there any tracked or untracked modifications in the worktree? */
function hasDirtyTree() {
  const out = run("git", ["status", "--porcelain"], { silent: true });
  return out.trim().length > 0;
}

/** Parse CLI args. First positional is the target ref; optional --force. */
function parse(argv) {
  let force = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  return { force, targetRef: positional[0] };
}

function printUsage() {
  process.stderr.write(
    [
      "Usage: node scripts/bundle-diff.mjs <ref> [--force]",
      "",
      "Compare the current build's bundle manifest against a build of <ref>.",
      "<ref> can be a branch name, tag, or commit SHA.",
      "",
      "Examples:",
      "  node scripts/bundle-diff.mjs main",
      "  node scripts/bundle-diff.mjs HEAD~1",
      "",
      "The script stashes any uncommitted changes, builds <ref>, restores",
      "HEAD, and prints a markdown table of the diff. Pass --force to",
      "attempt the run even with a dirty working tree (not recommended).",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help || !args.targetRef) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const initial = readCurrentRef();
  const dirty = hasDirtyTree();
  if (dirty && !args.force) {
    console.error(
      "bundle-diff: working tree has uncommitted changes. Commit or stash them first,\n" +
        "or pass --force to override (the script will stash for you).",
    );
    process.exit(1);
  }

  let stashed = false;
  try {
    // 1. Build current.
    console.error("bundle-diff: building CURRENT (HEAD)...");
    run("npm", ["run", "build", "--workspace", "@aethelred/wallet-extension"]);
    const currentManifest = await generateBundleManifest({ distDir: DIST_DIR });

    // 2. Stash everything (tracked + untracked) so the checkout is clean.
    if (dirty) {
      run("git", ["stash", "push", "--include-untracked", "-m", "bundle-diff-auto"]);
      stashed = true;
    }

    // 3. Check out the target ref. --detach avoids moving the user's branch.
    console.error(`bundle-diff: checking out ${args.targetRef}...`);
    run("git", ["checkout", "--detach", args.targetRef]);

    // 4. Build the target ref.
    console.error(`bundle-diff: building ${args.targetRef}...`);
    run("npm", ["run", "build", "--workspace", "@aethelred/wallet-extension"]);
    const baselineManifest = await generateBundleManifest({ distDir: DIST_DIR });

    // 5. Restore.
    console.error(`bundle-diff: restoring ${initial.kind === "branch" ? initial.ref : "HEAD"}...`);
    run("git", ["checkout", initial.ref]);
    if (stashed) {
      run("git", ["stash", "pop"]);
      stashed = false;
    }

    // 6. Compare and print.
    const summary = compareBundle({
      baseline: baselineManifest,
      current: currentManifest,
    });
    process.stdout.write(renderMarkdown(summary));
    if (summary.exitCode !== 0) {
      process.exit(summary.exitCode);
    }
  } catch (err) {
    console.error(`bundle-diff: ${err.message}`);
    // Best-effort restore.
    try {
      run("git", ["checkout", initial.ref]);
    } catch {
      console.error(`bundle-diff: WARNING failed to restore ${initial.ref}; inspect 'git status'.`);
    }
    if (stashed) {
      try {
        run("git", ["stash", "pop"]);
      } catch {
        console.error(
          "bundle-diff: WARNING failed to pop stash; your work is in 'git stash list'.",
        );
      }
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
