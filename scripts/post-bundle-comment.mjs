#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * post-bundle-comment.mjs — sticky PR comment with bundle delta
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Reads the markdown produced by `compare-bundle.mjs` and posts it on
 * the pull request as a sticky comment (creates on first run, updates
 * thereafter). The stickiness is implemented with a hidden marker in
 * the comment body; subsequent runs look for the same marker and
 * overwrite it rather than spamming a new comment every push.
 *
 * Why no SDK?
 * -----------
 * We keep this script dependency-free on purpose. Pulling in
 * `@actions/github` or `@octokit/rest` would land a runtime tree of
 * ~50 packages inside the CI image for a feature that needs four API
 * calls. `fetch` + a hand-rolled marker is ~80 lines and has zero
 * supply-chain surface area.
 *
 * Environment contract
 * --------------------
 *   GITHUB_TOKEN       — required in CI. Scope: `pull-requests: write`.
 *   GITHUB_REPOSITORY  — "owner/repo" (GitHub Actions provides this).
 *   GITHUB_EVENT_PATH  — path to the event JSON blob (GitHub Actions
 *                        provides this). We use it to extract the PR
 *                        number from `pull_request.number`.
 *
 * If any of these are missing the script falls back to printing the
 * markdown to stdout, which is the correct behavior for:
 *
 *   • local runs (no token, just want the report)
 *   • push events on `main` (no PR to comment on)
 *   • forked-PR runs where GitHub intentionally withholds write tokens
 *
 * Exit code is always 0 on successful POST/PATCH or intentional no-op.
 * A non-zero exit means the GitHub API refused the request — treat as
 * a CI infrastructure issue, not a bundle-size regression.
 *
 * Owner: wallet-extension team. See docs/engineering/BUNDLE_BUDGETS.md.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_MD_PATH = resolve(
  REPO_ROOT,
  "apps",
  "extension",
  "dist",
  "_bundle-delta.md",
);

/** Hidden HTML comment used to find the bot's previous comment on the PR.
 *  Must be unique to this check so we do not collide with other bots.
 */
const STICKY_MARKER = "<!-- aethelred-bundle-gate:do-not-edit -->";

/** Parse --key value CLI flags. Same helper as the sibling scripts. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** Build the comment body: hidden marker on the first line, then markdown. */
export function buildCommentBody(markdown) {
  return `${STICKY_MARKER}\n${markdown}`;
}

/** Derive PR number from the GitHub Actions event payload. Returns null
 *  if this is not a pull_request event or the payload is unavailable.
 */
export function resolvePrNumber(event) {
  if (!event) return null;
  if (typeof event.number === "number") return event.number;
  if (event.pull_request && typeof event.pull_request.number === "number") {
    return event.pull_request.number;
  }
  return null;
}

/** Fetch all comments on a PR and return the one with our sticky marker,
 *  if any. GitHub paginates at 100 items; 200+ is extremely unlikely for
 *  a single PR discussion, but we cap the walk at 5 pages to be safe.
 */
async function findExistingComment({ repo, prNumber, token, fetchFn }) {
  for (let page = 1; page <= 5; page++) {
    const url =
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments` +
      `?per_page=100&page=${page}`;
    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API GET /issues/comments failed: ${res.status} ${res.statusText}`);
    }
    const page_items = await res.json();
    for (const c of page_items) {
      if (typeof c.body === "string" && c.body.startsWith(STICKY_MARKER)) {
        return c;
      }
    }
    if (page_items.length < 100) break;
  }
  return null;
}

/** Post (or update) the sticky comment. Exposed for tests via DI fetch. */
export async function postBundleComment({
  markdown,
  repo,
  prNumber,
  token,
  fetchFn = fetch,
}) {
  if (!markdown || !repo || !prNumber || !token) {
    throw new Error("postBundleComment: missing required parameter");
  }
  const body = buildCommentBody(markdown);
  const existing = await findExistingComment({ repo, prNumber, token, fetchFn });

  if (existing) {
    const url = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`;
    const res = await fetchFn(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API PATCH comment failed: ${res.status} ${res.statusText}`);
    }
    return { action: "updated", id: existing.id };
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API POST comment failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return { action: "created", id: json.id };
}

/** CLI entrypoint. See the header comment for the env contract. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mdPath = args.markdown ? resolve(args.markdown) : DEFAULT_MD_PATH;

  if (!existsSync(mdPath)) {
    console.error(
      `post-bundle-comment: markdown missing at ${mdPath}. ` +
        `Did 'npm run bundle:compare' run first?`,
    );
    process.exit(1);
  }
  const markdown = await readFile(mdPath, "utf8");

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!token || !repo || !eventPath) {
    // No PR context — print to stdout and exit cleanly. This is the
    // expected path for local invocations and for push events on main.
    process.stdout.write(markdown);
    console.error("post-bundle-comment: no GitHub PR context; printed to stdout only.");
    return;
  }

  let event;
  try {
    event = JSON.parse(await readFile(eventPath, "utf8"));
  } catch (err) {
    console.error(`post-bundle-comment: could not read event payload: ${err.message}`);
    process.stdout.write(markdown);
    return;
  }
  const prNumber = resolvePrNumber(event);
  if (!prNumber) {
    // Push to main or similar — not a PR.
    process.stdout.write(markdown);
    console.error("post-bundle-comment: event is not a pull_request; printed to stdout only.");
    return;
  }

  try {
    const result = await postBundleComment({ markdown, repo, prNumber, token });
    console.error(`post-bundle-comment: ${result.action} comment #${result.id} on PR #${prNumber}`);
  } catch (err) {
    console.error(`post-bundle-comment: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
