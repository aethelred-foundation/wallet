/**
 * Pure integrity primitives for the content-script injection path.
 *
 * Lives in its own module because `content.ts` has top-level side
 * effects (touches `chrome`, `document`) that blow up in a Node test
 * environment. Isolating the pure helpers here lets the integrity
 * tests import them directly without pulling in the injection
 * orchestration.
 */

/**
 * Result of an integrity verification.
 *
 * Discriminated-union shape: a mismatch exposes `actualHash` so log /
 * audit output can point at the value that didn't match, while the
 * match + skip cases don't redundantly carry it.
 *
 * Semantics:
 *   - `match`        — expected and actual hashes agree. Safe to inject.
 *   - `skip`         — sentinel was never stamped (dev build). Injection
 *                      proceeds because the browser's extension signing
 *                      still gives us integrity on the `getURL` path.
 *   - `mismatch`     — stamped hash and fetched bytes disagree. Hard
 *                      abort; carries `actualHash` for the alert.
 *   - `bytes-empty`  — the fetch returned zero bytes; not hostile, but
 *                      non-functional. Treated as not-ok.
 */
export type IntegrityResult =
  | { readonly ok: true; readonly reason: "match" | "skip"; readonly expected: string }
  | { readonly ok: false; readonly reason: "mismatch"; readonly expected: string; readonly actualHash: string }
  | { readonly ok: false; readonly reason: "bytes-empty"; readonly expected: string };

/**
 * The expected SHA-256 of the bundled `inpage.js` at build time.
 *
 * Vite's `vite-plugin-inpage-integrity` plugin rewrites the literal
 * string `"__INPAGE_INTEGRITY_HASH__"` in the emitted bundle with the
 * actual hex-encoded digest. Tests also pass this literal value to
 * assert the "unstamped build" failure mode.
 */
export const INPAGE_INTEGRITY_SENTINEL = "__INPAGE_INTEGRITY_HASH__";

/**
 * Verifies that the given byte buffer hashes to the expected value.
 *
 * Pure, platform-agnostic: uses `crypto.subtle` which is available in
 * both the content-script MAIN world and the Node test runner.
 *
 * @param expected - The expected SHA-256 (hex) stamped into the bundle
 *   at build time by `vite-plugin-inpage-integrity`. If still the
 *   literal sentinel (or any non-64-hex string), we treat the build
 *   as a dev build and return `{ ok: true, reason: "skip" }` so local
 *   development proceeds.
 * @param bytes - Raw `inpage.js` bytes fetched via
 *   `chrome.runtime.getURL()`.
 */
export async function verifyInpageIntegrity(
  expected: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<IntegrityResult> {
  const byteView = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (byteView.byteLength === 0) {
    return { ok: false, reason: "bytes-empty", expected };
  }
  // Dev-mode skip — the Vite plugin didn't stamp a hash, so we can't
  // compare. Chrome's extension signing still guarantees the served
  // bytes are the signed bundle; we just can't double-check here.
  if (expected === INPAGE_INTEGRITY_SENTINEL || expected.length !== 64) {
    return { ok: true, reason: "skip", expected };
  }
  // Hand `crypto.subtle.digest` a TypedArray, not a bare ArrayBuffer.
  // Two reasons, both load-bearing:
  //
  //   1. Realm safety. Node's webcrypto — which jsdom wires into the
  //      vitest environment — validates `BufferSource` inputs via a
  //      strict `instanceof ArrayBuffer` check against its own realm's
  //      constructor. A `new ArrayBuffer(…)` allocated in user-land
  //      can resolve to a different realm under the jsdom + Node-
  //      webcrypto combo and get rejected at runtime with
  //      `2nd argument is not instance of ArrayBuffer, Buffer,
  //      TypedArray, or DataView`. The CI-only failure surfaced here:
  //      local Node happens to align realms; the CI container does
  //      not. TypedArrays sidestep the hazard because the detection
  //      path goes through `ArrayBuffer.isView()`, which reads the
  //      realm-independent `[[TypedArrayName]]` internal slot instead
  //      of doing an `instanceof` identity check.
  //
  //   2. TS 5.x narrows `Uint8Array<ArrayBufferLike>` tighter than the
  //      plain-ArrayBuffer digest overload accepts. A
  //      `Uint8Array<ArrayBuffer>` input satisfies both overloads.
  //
  // We copy into a fresh standalone Uint8Array so the digest cannot be
  // influenced by post-hoc mutation of the caller's buffer, matching
  // the `toBufferSource` helper in `packages/connect` — single source
  // of truth for "how to feed crypto.subtle safely in our code."
  const standalone: Uint8Array<ArrayBuffer> = new Uint8Array(
    new ArrayBuffer(byteView.byteLength),
  );
  standalone.set(byteView);
  const digest = await crypto.subtle.digest("SHA-256", standalone);
  const actualHash = toHexLocal(new Uint8Array(digest));
  return actualHash === expected
    ? { ok: true, reason: "match", expected }
    : { ok: false, reason: "mismatch", expected, actualHash };
}

/** Hex encoder, local to this module to avoid cross-module coupling. */
function toHexLocal(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
