/**
 * Manifest contract test — Aethelred Wallet Chrome extension.
 *
 * Enforces the invariants Chrome Web Store review will check against
 * before shipping:
 *
 *   1. manifest_version is 3 (MV3 is required for all new submissions).
 *   2. name / description / version / action.default_popup / background
 *      are present and non-empty.
 *   3. host_permissions does NOT contain wildcard patterns that would
 *      trigger heightened CWS review (for example `<all_urls>` or
 *      `*:/` + `/*` style catchalls).
 *   4. icons include 16, 48, and 128 px at minimum.
 *   5. minimum_chrome_version is set (we target 120+).
 *   6. Every permission we declare has a justification block in
 *      store/chrome-web-store/PERMISSION_JUSTIFICATIONS.md — this
 *      prevents the manifest and the submission bundle from drifting.
 *   7. Every host_permission we declare also has a justification block
 *      in the same file.
 *
 * The test reads the SOURCE manifest at
 * `apps/extension/public/manifest.json` so it runs without requiring
 * a prior build. CI should still re-run the test against the built
 * `apps/extension/dist/manifest.json` as part of the packaging
 * pipeline — Vite copies `public/*` verbatim so the two files must
 * match byte-for-byte.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Locate the `apps/extension` root by walking up from `process.cwd()`
 * until we find `public/manifest.json`. Works whether the test is run
 * from the extension workspace or from the monorepo root. Tests run
 * under jsdom, where `import.meta.url` is a non-file URL — so we
 * cannot use `fileURLToPath` here.
 */
function findExtRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, "apps", "extension", "public", "manifest.json"))) {
      return resolve(dir, "apps", "extension");
    }
    if (existsSync(resolve(dir, "public", "manifest.json"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate apps/extension/public/manifest.json");
}

const EXT_ROOT = findExtRoot();
const REPO_ROOT = resolve(EXT_ROOT, "..", "..");
const MANIFEST_PATH = resolve(EXT_ROOT, "public", "manifest.json");
const JUSTIFICATIONS_PATH = resolve(
  REPO_ROOT,
  "store",
  "chrome-web-store",
  "PERMISSION_JUSTIFICATIONS.md",
);

interface Manifest {
  manifest_version: number;
  name?: string;
  description?: string;
  version?: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  action?: { default_popup?: string };
  background?: { service_worker?: string };
  content_scripts?: Array<{ matches?: string[] }>;
}

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as Manifest;
}

function loadJustifications(): string {
  return readFileSync(JUSTIFICATIONS_PATH, "utf8");
}

describe("manifest.json — Chrome Web Store contract", () => {
  const manifest = loadManifest();
  const justifications = loadJustifications();

  it("is Manifest V3 (required for 2024+ submissions)", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("declares name, description, and version", () => {
    expect(manifest.name, "name must be set").toBeTruthy();
    expect(manifest.name?.length ?? 0).toBeLessThanOrEqual(45);
    expect(manifest.description, "description must be set").toBeTruthy();
    expect(
      manifest.description?.length ?? 0,
      "description must fit CWS 132-char limit",
    ).toBeLessThanOrEqual(132);
    expect(manifest.version, "version must be set").toBeTruthy();
    // Semver-ish: X.Y.Z optionally followed by -pre.N.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:[-.][\w.]+)?$/);
  });

  it("declares an action popup and a background service worker", () => {
    expect(manifest.action?.default_popup).toBe("popup.html");
    expect(manifest.background?.service_worker).toBe("background.js");
  });

  it("pins a minimum Chrome version of 120 or newer", () => {
    expect(manifest.minimum_chrome_version).toBeTruthy();
    const major = Number.parseInt(
      manifest.minimum_chrome_version ?? "0",
      10,
    );
    expect(major).toBeGreaterThanOrEqual(120);
  });

  it("icons include 16, 48, and 128 px", () => {
    const sizes = Object.keys(manifest.icons ?? {}).map((s) =>
      Number.parseInt(s, 10),
    );
    for (const required of [16, 48, 128]) {
      expect(
        sizes,
        `icons must include size ${required}`,
      ).toContain(required);
    }
  });

  it("host_permissions does NOT contain wildcards (<all_urls>, *://*/*)", () => {
    const hosts = manifest.host_permissions ?? [];
    const bannedPatterns = [
      "<all_urls>",
      "*://*/*",
      "http://*/*",
      "https://*/*",
      "*://*",
    ];
    for (const h of hosts) {
      expect(bannedPatterns, `banned host pattern detected: ${h}`).not.toContain(
        h,
      );
      // Also fail if a host_permission starts with `*://` (any scheme).
      expect(h.startsWith("*://"), `host ${h} uses wildcard scheme`).toBe(
        false,
      );
    }
  });

  it("every declared permission has a justification block", () => {
    const perms = manifest.permissions ?? [];
    for (const perm of perms) {
      const marker = `Permission: \`${perm}\``;
      expect(
        justifications,
        `PERMISSION_JUSTIFICATIONS.md is missing '${marker}'`,
      ).toContain(marker);
    }
  });

  it("every declared host_permission has a justification block", () => {
    const hosts = manifest.host_permissions ?? [];
    // Strip the trailing `/*` path-wildcard because the justifications
    // file groups hosts by origin, not by path.
    const origins = hosts.map((h) => h.replace(/\/\*$/, ""));
    // Some origins share a justification block (e.g. all llamarpc or
    // publicnode hosts may be referenced together). We require that
    // EACH origin literally appears somewhere in the doc.
    for (const origin of origins) {
      expect(
        justifications,
        `PERMISSION_JUSTIFICATIONS.md does not mention host ${origin}`,
      ).toContain(origin);
    }
  });

  it("content_scripts use specific schemes, not <all_urls>", () => {
    for (const cs of manifest.content_scripts ?? []) {
      for (const m of cs.matches ?? []) {
        expect(
          m,
          "content_scripts.matches should not be <all_urls>",
        ).not.toBe("<all_urls>");
      }
    }
  });
});
