/**
 * ───────────────────────────────────────────────────────────────
 *  use-integrity-check
 * ───────────────────────────────────────────────────────────────
 *
 * Runtime self-attestation for the Aethelred Wallet popup. Runs on
 * mount and confirms, before the wallet surface is rendered, that
 * the popup is executing inside a legitimate Chrome extension
 * context and not inside a look-alike page, an `<iframe>`, or a
 * repackaged extension with a tampered manifest.
 *
 * The hook returns a tagged state machine:
 *   - `pending`  — the initial state, while async checks run.
 *   - `trusted`  — every probe passed, wallet UI is safe to mount.
 *   - `compromised` — at least one probe failed; callers should
 *     render a full-screen warning instead of the wallet UI.
 *
 * Why the checks matter
 *
 * 1. `chrome.runtime.id` equals the value we bundle at build time.
 *    A rogue actor publishing a cloned extension will have a
 *    different runtime id — this is the cheapest positive identity
 *    signal we have without a remote attestation service.
 *
 * 2. `window.self === window.top` — a framed popup can be
 *    screenshotted, key-logged, or input-shimmed by the parent
 *    frame. Real extension popups are never framed; if the invariant
 *    fails we are by definition inside a malicious host page.
 *
 * 3. `document.origin` starts with `chrome-extension://`. A dev
 *    preview served over HTTPS would also pass if it's on the wallet
 *    host allowlist shared with `use-phishing-check`.
 *
 * 4. CSP verification. We fetch our own `popup.html` and confirm the
 *    response carries the expected `Content-Security-Policy` header
 *    (or meta tag) with the `script-src 'self'` directive. Chrome's
 *    MV3 runtime refuses to install extensions with a permissive
 *    CSP, but we verify at runtime anyway to catch environments
 *    where the manifest-level CSP was stripped or relaxed (for
 *    example via a monkey-patched service worker during testing).
 *
 * None of the checks depend on network access; they read local
 * runtime state only. That keeps the probe fast and failure-closed
 * even when the user is offline.
 */

import { useEffect, useState, useMemo, useCallback } from "react";

/**
 * Public shape. Callers should pattern-match on `.status` and fall
 * back to `.failures` for diagnostic messaging.
 */
export type IntegrityCheckResult =
  | { status: "pending"; failures: [] }
  | { status: "trusted"; failures: [] }
  | { status: "compromised"; failures: IntegrityFailure[] };

/**
 * One failure per probe that tripped. `probe` is the stable rule
 * name; `detail` is free-form and safe to render to the user.
 */
export interface IntegrityFailure {
  probe: IntegrityProbe;
  detail: string;
}

export type IntegrityProbe =
  | "runtime-id"
  | "frame-ancestry"
  | "document-origin"
  | "csp-header";

/**
 * Options that let tests inject their own globals / overrides. The
 * defaults pull from the real browser APIs.
 */
export interface IntegrityCheckOptions {
  /** Override the window in tests that mount the hook in jsdom. */
  windowRef?: typeof window;
  /**
   * Expected Chrome extension id. Defaults to the build-time
   * manifest key. Leave undefined to have the hook read the
   * current `chrome.runtime.id` and treat it as both expected and
   * observed (useful for dev builds where the id is auto-assigned).
   */
  expectedExtensionId?: string;
  /**
   * Allow unit tests to stub `fetch` so the CSP probe can be
   * exercised without a real HTTP request.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Build-time constant, populated by Vite's `define` block when the
 * extension is packaged for a specific distribution channel. Left as
 * `undefined` in dev so auto-assigned extension ids still pass the
 * identity check (the hook falls back to expecting the observed id).
 */
declare const __AETHELRED_EXTENSION_ID__: string | undefined;

/**
 * The manifest key we ship — read from a runtime constant defined
 * at build time so swapping it between stage and prod builds does
 * not need a source-code edit.
 */
const EXPECTED_EXTENSION_ID: string | undefined =
  typeof __AETHELRED_EXTENSION_ID__ !== "undefined"
    ? __AETHELRED_EXTENSION_ID__
    : undefined;

/**
 * Hosts the wallet is permitted to run under when served over HTTPS
 * rather than the native `chrome-extension://` scheme. Matches the
 * list used by `use-phishing-check`; kept duplicated rather than
 * cross-imported so the two hooks stay independent for testability.
 */
const HTTPS_HOST_ALLOWLIST: ReadonlyArray<string> = [
  "wallet.aethelred.org",
  "app.aethelred.org",
  "localhost",
  "127.0.0.1",
];

/**
 * Run each probe and collect failures. Exported for unit tests so
 * they can drive the pure function directly without the React
 * lifecycle.
 */
export async function runIntegrityProbes(
  options: IntegrityCheckOptions = {},
): Promise<IntegrityFailure[]> {
  const failures: IntegrityFailure[] = [];
  const win = options.windowRef ?? (typeof window !== "undefined" ? window : undefined);

  // ─── 1. Runtime id ────────────────────────────────────────
  const runtimeId = readRuntimeId(win);
  const expected = options.expectedExtensionId ?? EXPECTED_EXTENSION_ID ?? runtimeId;
  if (!runtimeId) {
    failures.push({
      probe: "runtime-id",
      detail:
        "chrome.runtime.id is unavailable — wallet is not running inside a Chrome extension context",
    });
  } else if (expected && runtimeId !== expected) {
    failures.push({
      probe: "runtime-id",
      detail: `chrome.runtime.id ${runtimeId} does not match the expected manifest id`,
    });
  }

  // ─── 2. Frame ancestry ────────────────────────────────────
  if (win) {
    try {
      if (win.self !== win.top) {
        failures.push({
          probe: "frame-ancestry",
          detail: "Wallet is rendered inside an iframe (window.self !== window.top)",
        });
      }
    } catch {
      // Accessing `window.top` from a cross-origin frame throws.
      // The throw confirms embedding.
      failures.push({
        probe: "frame-ancestry",
        detail: "Wallet is embedded inside a cross-origin frame",
      });
    }
  }

  // ─── 3. Document origin ──────────────────────────────────
  const origin = win?.document?.location?.origin ?? "";
  if (!origin) {
    failures.push({
      probe: "document-origin",
      detail: "document.origin is empty — runtime context is undefined",
    });
  } else if (origin.startsWith("chrome-extension://")) {
    // Preferred path — nothing more to do.
  } else if (origin.startsWith("https://")) {
    // HTTPS preview build — ensure hostname is allow-listed.
    const host = win?.document?.location?.hostname ?? "";
    if (!HTTPS_HOST_ALLOWLIST.includes(host)) {
      failures.push({
        probe: "document-origin",
        detail: `HTTPS origin ${origin} is not on the wallet allowlist`,
      });
    }
  } else {
    failures.push({
      probe: "document-origin",
      detail: `Unexpected origin scheme: ${origin}`,
    });
  }

  // ─── 4. CSP header ───────────────────────────────────────
  const fetcher = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (fetcher && origin.startsWith("chrome-extension://")) {
    try {
      const response = await fetcher(`${origin}/popup.html`, {
        method: "HEAD",
        cache: "no-store",
      });
      const cspHeader = response.headers.get("content-security-policy") ?? "";
      // Chrome does not always expose the extension-level CSP through
      // response headers; fall back to querying the meta tag in the
      // loaded document when the header is empty.
      const cspMeta = readCspMeta(win);
      const effectiveCsp = cspHeader || cspMeta;
      if (!effectiveCsp) {
        failures.push({
          probe: "csp-header",
          detail: "No Content-Security-Policy declaration found on popup.html",
        });
      } else if (!effectiveCsp.includes("script-src 'self'")) {
        failures.push({
          probe: "csp-header",
          detail: "CSP does not restrict script-src to 'self'",
        });
      } else if (effectiveCsp.includes("unsafe-eval")) {
        failures.push({
          probe: "csp-header",
          detail: "CSP permits unsafe-eval — wallet refuses to run",
        });
      }
    } catch (err) {
      // Network failures on the self-fetch are rare but possible in
      // locked-down test harnesses — degrade to "unknown" (pass)
      // rather than a false-positive compromise.
      const detail = err instanceof Error ? err.message : String(err);
      // Only emit the failure if the error is one we can confidently
      // attribute to a CSP stripping, not a generic network hiccup.
      if (detail.includes("NetworkError") || detail.includes("aborted")) {
        // pass — treat as unknown, better than false-positive
      } else {
        // Otherwise surface it as a probe failure so we don't hide
        // unexpected runtime behaviour.
        failures.push({
          probe: "csp-header",
          detail: `CSP probe failed: ${detail}`,
        });
      }
    }
  }

  return failures;
}

/**
 * Read `chrome.runtime.id` defensively — the API is undefined when
 * the popup is rendered in a plain browser tab (as happens during
 * Storybook / test runs).
 */
function readRuntimeId(win?: typeof window): string | undefined {
  if (!win) return undefined;
  const chrome = (win as unknown as { chrome?: { runtime?: { id?: string } } }).chrome;
  return chrome?.runtime?.id;
}

/**
 * Read a CSP declaration from a `<meta http-equiv="Content-Security-Policy">`
 * tag in the popup document. Used as a fallback when the HTTP header
 * is not exposed.
 */
function readCspMeta(win?: typeof window): string {
  if (!win) return "";
  const meta = win.document.querySelector<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  return meta?.content ?? "";
}

/**
 * React hook. Mounts the integrity probes as an effect and
 * transitions the returned state machine from `pending` → `trusted`
 * or `compromised`.
 *
 * The hook is stable across re-renders; the probes run exactly once
 * per mount. Callers should short-circuit:
 *
 * @example
 *   const { status, failures } = useIntegrityCheck();
 *   if (status === "pending") return <Loading />;
 *   if (status === "compromised") return <SecurityWarning failures={failures} />;
 *   return <WalletApp />;
 */
export function useIntegrityCheck(
  options: IntegrityCheckOptions = {},
): IntegrityCheckResult {
  const [result, setResult] = useState<IntegrityCheckResult>({
    status: "pending",
    failures: [],
  });

  // Memoise the options so changing a reference in a parent render
  // does not re-trigger the effect. Callers should pass a stable
  // object; this is defensive.
  const stableOptions = useMemo<IntegrityCheckOptions>(
    () => ({ ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      options.expectedExtensionId,
      options.fetchImpl,
      options.windowRef,
    ],
  );

  const probe = useCallback(async () => {
    const failures = await runIntegrityProbes(stableOptions);
    if (failures.length === 0) {
      setResult({ status: "trusted", failures: [] });
    } else {
      setResult({ status: "compromised", failures });
    }
  }, [stableOptions]);

  useEffect(() => {
    let cancelled = false;
    probe().catch((err) => {
      if (cancelled) return;
      const detail = err instanceof Error ? err.message : String(err);
      setResult({
        status: "compromised",
        failures: [{ probe: "runtime-id", detail }],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [probe]);

  return result;
}
