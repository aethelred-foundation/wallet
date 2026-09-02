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
const POPUP_HTML_PATH = resolve(EXT_ROOT, "popup.html");
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
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    run_at?: string;
    world?: "ISOLATED" | "MAIN";
  }>;
  content_security_policy?: {
    extension_pages?: string;
    sandbox?: string;
  };
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

  it("loads the provider in MAIN world and the bridge in ISOLATED world", () => {
    const scripts = manifest.content_scripts ?? [];
    expect(scripts).toContainEqual(
      expect.objectContaining({
        js: ["inpage.js"],
        run_at: "document_start",
        world: "MAIN",
      }),
    );
    expect(scripts).toContainEqual(
      expect.objectContaining({
        js: ["content.js"],
        run_at: "document_start",
        world: "ISOLATED",
      }),
    );
  });

  describe("content_security_policy — MV3 hardening", () => {
    it("declares content_security_policy.extension_pages", () => {
      expect(
        manifest.content_security_policy,
        "content_security_policy block must be present",
      ).toBeDefined();
      expect(
        manifest.content_security_policy?.extension_pages,
        "content_security_policy.extension_pages must be a non-empty string",
      ).toBeTruthy();
    });

    it("CSP explicitly sets script-src to 'self' (no remote scripts)", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      expect(csp).toContain("script-src 'self'");
    });

    it("CSP does NOT permit 'unsafe-eval'", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      expect(
        csp.includes("unsafe-eval"),
        "CSP must not allow 'unsafe-eval' — eval/Function ctor is a remote-code-execution primitive",
      ).toBe(false);
    });

    it("CSP does NOT permit 'unsafe-inline' for script-src", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      // Allow 'unsafe-inline' on style-src (React inline styles), but
      // never on script-src. We split the script-src directive and
      // check that substring only.
      const scriptSrcMatch = csp.match(/script-src[^;]*/);
      expect(
        scriptSrcMatch,
        "CSP must declare a script-src directive",
      ).toBeTruthy();
      const scriptSrc = scriptSrcMatch ? scriptSrcMatch[0] : "";
      expect(
        scriptSrc.includes("unsafe-inline"),
        "script-src must not contain 'unsafe-inline'",
      ).toBe(false);
    });

    it("popup.html uses packaged scripts and contains no inline JavaScript", () => {
      const popupHtml = readFileSync(POPUP_HTML_PATH, "utf8");
      const popupMarkup = popupHtml.replace(/<!--[\s\S]*?-->/g, "");
      const inlineScripts = popupMarkup.match(
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi,
      );

      expect(
        inlineScripts,
        "Manifest V3 blocks inline popup scripts under script-src 'self'",
      ).toBeNull();
      expect(popupHtml).toContain('<script src="/splash.js"></script>');
    });

    it("CSP restricts object-src to 'self' (no Flash / plugin injection)", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      expect(csp).toContain("object-src 'self'");
    });

    it("CSP connect-src lists every declared host_permission origin", () => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      const connectMatch = csp.match(/connect-src[^;]*/);
      expect(
        connectMatch,
        "CSP must declare a connect-src directive",
      ).toBeTruthy();
      const connectSrc = connectMatch ? connectMatch[0] : "";
      const hosts = manifest.host_permissions ?? [];
      for (const host of hosts) {
        // host_permissions look like `https://eth.llamarpc.com/*`; the
        // CSP origin form drops the trailing `/*`.
        const origin = host.replace(/\/\*$/, "");
        expect(
          connectSrc,
          `connect-src must include ${origin}`,
        ).toContain(origin);
      }
    });

    it("permits loopback dev nodes on ANY port (bring-your-own-node)", () => {
      // The wallet's update-network-rpc lets an operator point a network at
      // a local node; per-dApp devnets run on assorted loopback ports.
      // Pinning a single port (e.g. only :8545) makes every other local
      // node fail with an opaque "Failed to fetch" during gas estimation.
      const hosts = manifest.host_permissions ?? [];
      // Host-permission match patterns are port-agnostic, so the loopback
      // hosts must be declared without a port to cover all of them.
      expect(hosts, "loopback 127.0.0.1 must be allowed on any port").toContain(
        "http://127.0.0.1/*",
      );
      expect(hosts, "loopback localhost must be allowed on any port").toContain(
        "http://localhost/*",
      );
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? "";
      expect(connectSrc).toContain("http://127.0.0.1:*");
      expect(connectSrc).toContain("http://localhost:*");
    });

    it("CSP declares a sandbox directive (prep for future sandboxed pages)", () => {
      expect(
        manifest.content_security_policy?.sandbox,
        "sandbox CSP should be declared even when there are no sandboxed pages yet",
      ).toBeTruthy();
      const sandbox = manifest.content_security_policy?.sandbox ?? "";
      expect(sandbox).toContain("sandbox");
    });
  });
});
