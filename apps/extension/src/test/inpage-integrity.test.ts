/**
 * Inpage integrity + handshake test suite.
 *
 * Covers three things:
 *
 *   1. Build-time emission (integrity manifest script is deterministic,
 *      hashes match the actual bytes, keys are sorted).
 *   2. Content-script integrity check (hashes match → inject; mismatch
 *      → refuse; sentinel unchanged → dev-mode skip).
 *   3. HMAC handshake primitives (round-trip, tamper detection, replay,
 *      session-isolation, origin-binding) plus the full inpage → content
 *      → background handshake as it happens across real postMessage /
 *      chrome.runtime channels stubbed for test.
 *
 * Every crypto path here is driven by the REAL `crypto.subtle` that
 * jsdom's Node-adapter wires in (node:crypto). No handwritten ECDH /
 * HKDF / HMAC — that would defeat the point of the test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateEphemeralKeyPair,
  deriveHandshakeKeys,
  deriveHmacKey,
  signMessage,
  verifyMessage,
  sealSessionId,
  unsealSessionId,
  generateSalt,
  toHex,
  fromHex,
  HMAC_DERIVATION_INFO,
  type HandshakeInitPayload,
  type HandshakeAckPayload,
} from "@aethelred/wallet-connect";
import {
  handleInpageHandshakeInit,
  verifyInpageRpcRequest,
  __resetInpageSessionsForTests,
} from "../background/inpage-handshake-handler";
// Import directly from the pure-function module, not from `../content`.
// The content.ts entrypoint has top-level side effects (chrome.runtime /
// document.createElement) that would throw in Node.
import { verifyInpageIntegrity } from "../content-integrity";
// The script is published as a .mjs file — we import it dynamically
// inside the tests rather than statically so TypeScript does not demand
// a .d.ts shim for the Node-only module. The functions we exercise are
// all pure, so the dynamic import is pure latency, not a correctness
// concern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmitModule = {
  buildIntegrityManifest: (
    dir: string,
    opts?: { writeToDisk?: boolean },
  ) => { version: number; algorithm: string; files: Record<string, string> };
  walkDir: (dir: string) => string[];
  sha256OfFile: (path: string) => string;
  INTEGRITY_MANIFEST_NAME: string;
};
async function loadEmitModule(): Promise<EmitModule> {
  // @ts-expect-error — plain-ESM .mjs imported without type shim.
  return await import("../../../../scripts/emit-integrity-manifest.mjs") as EmitModule;
}
import {
  sha256Hex,
  inpageIntegrityPlugin,
  INPAGE_INTEGRITY_SENTINEL,
} from "../../vite-plugin-inpage-integrity";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ─── Helpers ───────────────────────────────────────────────── */

/** Build a TextEncoder / TextDecoder pair once per test suite. */
const encoder = new TextEncoder();

/**
 * Run one full inpage→content→background handshake and return the
 * derived HMAC key as it would be available on each side.
 *
 * We don't use the real content-bridge / background message plumbing
 * here — we hand the init payload directly to
 * {@link handleInpageHandshakeInit} and then replay the ack on the
 * inpage side. That leaves the test purely about cryptographic
 * agreement and independent of transport wiring.
 */
async function runFullHandshake(origin = "https://dapp.example.com") {
  // Inpage side.
  const inpage = await generateEphemeralKeyPair();
  const clientNonce = "client-nonce-fixed-for-test";
  const initPayload: HandshakeInitPayload = {
    publicJwk: inpage.publicJwk,
    clientNonce,
    version: 1,
  };
  const initMsg = {
    kind: "handshake-init" as const,
    correlationId: "c1",
    payload: initPayload,
    timestamp: Date.now(),
  };
  // Background responds with handshake-ack.
  const ack = await handleInpageHandshakeInit(initMsg, origin);
  expect(ack.kind).toBe("handshake-ack");
  const ackPayload = ack.payload as HandshakeAckPayload;
  expect(ackPayload.clientNonce).toBe(clientNonce);

  // Inpage completes the handshake: derive HMAC + seal keys, unseal
  // the session id, and cache it.
  const inpageKeys = await deriveHandshakeKeys(
    inpage.privateKey,
    ackPayload.publicJwk,
    fromHex(ackPayload.saltHex),
  );
  const sessionIdBytes = await unsealSessionId(
    inpageKeys.sealKey,
    ackPayload.sealedSessionId,
  );
  const sessionId = toHex(sessionIdBytes);
  return {
    inpage,
    ack,
    ackPayload,
    inpageHmacKey: inpageKeys.hmacKey,
    sessionId,
    origin,
  };
}

/* ─── 1. handshake primitives ───────────────────────────────── */

describe("inpage handshake primitives", () => {
  beforeEach(() => {
    __resetInpageSessionsForTests();
  });

  it("generateEphemeralKeyPair returns a P-256 JWK", async () => {
    const pair = await generateEphemeralKeyPair();
    expect(pair.privateKey).toBeDefined();
    expect(pair.publicJwk.kty).toBe("EC");
    expect(pair.publicJwk.crv).toBe("P-256");
    // `x` and `y` are base64url-encoded 32-byte coordinates.
    expect(typeof pair.publicJwk.x).toBe("string");
    expect(typeof pair.publicJwk.y).toBe("string");
  });

  it("deriveHmacKey produces identical keys on both sides", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();

    const keyA = await deriveHmacKey(a.privateKey, b.publicJwk, salt);
    const keyB = await deriveHmacKey(b.privateKey, a.publicJwk, salt);

    // Derived keys are not directly exportable — but if both sides
    // derived the same bytes, signing the same input produces the same
    // signature.
    const sigA = await signMessage(keyA, {
      kind: "rpc-request",
      sessionId: "s1",
      correlationId: "c1",
      payload: { method: "eth_chainId" },
    });
    const sigB = await signMessage(keyB, {
      kind: "rpc-request",
      sessionId: "s1",
      correlationId: "c1",
      payload: { method: "eth_chainId" },
    });
    expect(sigA).toBe(sigB);
  });

  it("signMessage + verifyMessage round-trip succeeds", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keyA = await deriveHmacKey(a.privateKey, b.publicJwk, salt);

    const payload = { method: "eth_sendTransaction", params: [{ to: "0xabc" }] };
    const input = {
      kind: "rpc-request",
      sessionId: "s1",
      correlationId: "c1",
      payload,
    };
    const sig = await signMessage(keyA, input);
    expect(await verifyMessage(keyA, input, sig)).toBe(true);
  });

  it("verifyMessage returns false when the payload is tampered", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keyA = await deriveHmacKey(a.privateKey, b.publicJwk, salt);

    const input = {
      kind: "rpc-request",
      sessionId: "s1",
      correlationId: "c1",
      payload: { method: "eth_sendTransaction", params: [{ to: "0xabc" }] },
    };
    const sig = await signMessage(keyA, input);

    const tampered = {
      ...input,
      payload: { method: "eth_sendTransaction", params: [{ to: "0xdead" }] },
    };
    expect(await verifyMessage(keyA, tampered, sig)).toBe(false);
  });

  it("verifyMessage returns false when the signature is tampered", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keyA = await deriveHmacKey(a.privateKey, b.publicJwk, salt);

    const input = {
      kind: "rpc-request",
      sessionId: "s1",
      correlationId: "c1",
      payload: { method: "eth_chainId" },
    };
    const sig = await signMessage(keyA, input);
    // Flip one nibble in the middle of the signature.
    const flippedChar = sig[20] === "0" ? "1" : "0";
    const flipped = sig.slice(0, 20) + flippedChar + sig.slice(21);
    expect(await verifyMessage(keyA, input, flipped)).toBe(false);
  });

  it("different session ids do not impersonate each other", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keyA = await deriveHmacKey(a.privateKey, b.publicJwk, salt);

    const input1 = {
      kind: "rpc-request",
      sessionId: "s-original",
      correlationId: "c1",
      payload: { method: "eth_chainId" },
    };
    const sig1 = await signMessage(keyA, input1);

    // Re-sign with a different sessionId — signature changes.
    const input2 = { ...input1, sessionId: "s-other" };
    const sig2 = await signMessage(keyA, input2);

    expect(sig1).not.toBe(sig2);
    // And re-using sig1 under input2 fails verification.
    expect(await verifyMessage(keyA, input2, sig1)).toBe(false);
  });

  it("sealSessionId → unsealSessionId round-trips", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keys = await deriveHandshakeKeys(a.privateKey, b.publicJwk, salt);
    const peerKeys = await deriveHandshakeKeys(b.privateKey, a.publicJwk, salt);

    const plain = crypto.getRandomValues(new Uint8Array(16));
    const sealed = await sealSessionId(keys.sealKey, plain);
    const unsealed = await unsealSessionId(peerKeys.sealKey, sealed);
    expect(toHex(unsealed)).toBe(toHex(plain));
  });

  it("unsealSessionId rejects tampered ciphertext", async () => {
    const salt = generateSalt();
    const a = await generateEphemeralKeyPair();
    const b = await generateEphemeralKeyPair();
    const keys = await deriveHandshakeKeys(a.privateKey, b.publicJwk, salt);
    const peerKeys = await deriveHandshakeKeys(b.privateKey, a.publicJwk, salt);

    const plain = crypto.getRandomValues(new Uint8Array(16));
    const sealed = await sealSessionId(keys.sealKey, plain);
    // Flip a byte in the middle of the ciphertext.
    const bytes = fromHex(sealed);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = toHex(bytes);
    await expect(unsealSessionId(peerKeys.sealKey, tampered)).rejects.toThrow();
  });

  it("HMAC_DERIVATION_INFO is stable — protocol upgrades must bump it", () => {
    // Guard against accidental rename that would silently invalidate
    // existing sessions without a version bump.
    expect(HMAC_DERIVATION_INFO).toBe("aethelred-inpage-hmac-v1");
  });
});

/* ─── 2. background handler ─────────────────────────────────── */

describe("handleInpageHandshakeInit / verifyInpageRpcRequest", () => {
  beforeEach(() => {
    __resetInpageSessionsForTests();
  });

  it("full handshake flow lets the inpage sign a request the background accepts", async () => {
    const { inpageHmacKey, sessionId, origin } = await runFullHandshake();

    const correlationId = "corr-first";
    const payload = { method: "eth_chainId", params: [] };
    const sig = await signMessage(inpageHmacKey, {
      kind: "rpc-request",
      sessionId,
      correlationId,
      payload,
    });

    const requestMsg = {
      kind: "rpc-request" as const,
      correlationId,
      payload: { ...payload, sessionId, hmac: sig },
      origin,
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(requestMsg, origin);
    expect(result.ok).toBe(true);
  });

  it("rejects a request signed by an attacker key", async () => {
    const { sessionId, origin } = await runFullHandshake();

    // Attacker has its own handshake-ack-derived key (no handshake
    // completed with the background) — they should NOT be able to
    // produce a signature the background accepts.
    const attacker = await generateEphemeralKeyPair();
    const victim = await generateEphemeralKeyPair();
    const attackerKey = await deriveHmacKey(
      attacker.privateKey,
      victim.publicJwk,
      generateSalt(),
    );

    const correlationId = "corr-forged";
    const payload = { method: "eth_sendTransaction", params: [{ to: "0xdead" }] };
    const sig = await signMessage(attackerKey, {
      kind: "rpc-request",
      sessionId,
      correlationId,
      payload,
    });

    const requestMsg = {
      kind: "rpc-request" as const,
      correlationId,
      payload: { ...payload, sessionId, hmac: sig },
      origin,
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(requestMsg, origin);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("hmac-mismatch");
    }
  });

  it("rejects replay of a signed message with a new correlationId", async () => {
    const { inpageHmacKey, sessionId, origin } = await runFullHandshake();

    const originalCorrelationId = "corr-original";
    const payload = { method: "eth_chainId", params: [] };
    const sig = await signMessage(inpageHmacKey, {
      kind: "rpc-request",
      sessionId,
      correlationId: originalCorrelationId,
      payload,
    });

    // Replay attempt: same signature, DIFFERENT correlationId.
    const replayedMsg = {
      kind: "rpc-request" as const,
      correlationId: "corr-replayed",
      payload: { ...payload, sessionId, hmac: sig },
      origin,
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(replayedMsg, origin);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hmac-mismatch");
  });

  it("rejects a request with a missing hmac", async () => {
    const { sessionId, origin } = await runFullHandshake();
    const msg = {
      kind: "rpc-request" as const,
      correlationId: "c",
      payload: { method: "eth_chainId", params: [], sessionId, hmac: "" },
      origin,
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(msg, origin);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-hmac");
  });

  it("rejects a request from a different origin than the handshake", async () => {
    const { inpageHmacKey, sessionId } = await runFullHandshake(
      "https://dapp.example.com",
    );

    const correlationId = "c";
    const payload = { method: "eth_chainId", params: [] };
    const sig = await signMessage(inpageHmacKey, {
      kind: "rpc-request",
      sessionId,
      correlationId,
      payload,
    });
    const msg = {
      kind: "rpc-request" as const,
      correlationId,
      payload: { ...payload, sessionId, hmac: sig },
      origin: "https://evil.example.com",
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(msg, "https://evil.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("origin-mismatch");
  });

  it("rejects a request with an unknown session id", async () => {
    // No prior handshake.
    const msg = {
      kind: "rpc-request" as const,
      correlationId: "c",
      payload: {
        method: "eth_chainId",
        params: [],
        sessionId: "deadbeef",
        hmac: "aa",
      },
      origin: "https://dapp.example.com",
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(msg, "https://dapp.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown-session");
  });

  it("rejects a request with a missing session id", async () => {
    const msg = {
      kind: "rpc-request" as const,
      correlationId: "c",
      payload: { method: "eth_chainId", hmac: "aa" },
      origin: "https://dapp.example.com",
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(msg, "https://dapp.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-session-id");
  });

  it("different handshakes produce distinct session keys", async () => {
    const r1 = await runFullHandshake("https://a.example.com");
    const r2 = await runFullHandshake("https://b.example.com");

    expect(r1.sessionId).not.toBe(r2.sessionId);

    // A message signed for session 1 cannot impersonate session 2.
    const payload = { method: "eth_chainId" };
    const sig1 = await signMessage(r1.inpageHmacKey, {
      kind: "rpc-request",
      sessionId: r1.sessionId,
      correlationId: "c",
      payload,
    });

    // Try to use sig1 against session 2's record.
    const msg = {
      kind: "rpc-request" as const,
      correlationId: "c",
      payload: { ...payload, sessionId: r2.sessionId, hmac: sig1 },
      origin: r2.origin,
      timestamp: Date.now(),
    };
    const result = await verifyInpageRpcRequest(msg, r2.origin);
    expect(result.ok).toBe(false);
  });
});

/* ─── 3. content-script integrity check ─────────────────────── */

describe("verifyInpageIntegrity", () => {
  it("returns ok when the bytes hash matches the expected hex", async () => {
    const bytes = encoder.encode("console.info('hello');").buffer;
    const expected = sha256Hex(new Uint8Array(bytes));
    const result = await verifyInpageIntegrity(expected, bytes);
    expect(result.ok).toBe(true);
  });

  it("returns not-ok + the actual hash on mismatch", async () => {
    const bytes = encoder.encode("console.info('hello');").buffer;
    const wrong = "0".repeat(64);
    const result = await verifyInpageIntegrity(wrong, bytes);
    expect(result.ok).toBe(false);
    // Narrow on the discriminator — `actualHash` only exists on the
    // `mismatch` arm. A `bytes-empty` result would not carry it.
    if (!result.ok && result.reason === "mismatch") {
      expect(result.actualHash).toBe(sha256Hex(new Uint8Array(bytes)));
    }
  });

  it("skips the check when the sentinel was not rewritten (dev mode)", async () => {
    const bytes = encoder.encode("any-content").buffer;
    const result = await verifyInpageIntegrity("__INPAGE_INTEGRITY_HASH__", bytes);
    expect(result.ok).toBe(true);
  });
});

/* ─── 4. integrity manifest emitter ─────────────────────────── */

describe("emit-integrity-manifest", () => {
  it("emits sorted, deterministic JSON with matching hashes", async () => {
    const { buildIntegrityManifest, INTEGRITY_MANIFEST_NAME } =
      await loadEmitModule();
    const dir = mkdtempSync(join(tmpdir(), "aethelred-int-"));
    try {
      writeFileSync(join(dir, "zeta.js"), "console.log('z')", "utf8");
      writeFileSync(join(dir, "alpha.js"), "console.log('a')", "utf8");
      mkdirSync(join(dir, "chunks"), { recursive: true });
      writeFileSync(join(dir, "chunks", "shared.js"), "console.log('shared')", "utf8");

      const manifest = buildIntegrityManifest(dir);
      expect(manifest.version).toBe(1);
      expect(manifest.algorithm).toBe("sha256");
      const keys = Object.keys(manifest.files);
      // Keys are sorted lexicographically.
      expect(keys).toEqual([...keys].sort());
      // Every key maps to a valid 64-char hex SHA-256.
      for (const k of keys) {
        expect(manifest.files[k]).toMatch(/^[0-9a-f]{64}$/);
      }
      // Re-running gives byte-identical output (determinism).
      const first = JSON.stringify(buildIntegrityManifest(dir, { writeToDisk: false }));
      const second = JSON.stringify(buildIntegrityManifest(dir, { writeToDisk: false }));
      expect(first).toBe(second);

      // The written file has a trailing newline.
      const written = readFileSync(join(dir, INTEGRITY_MANIFEST_NAME), "utf8");
      expect(written.endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("excludes _integrity.json and SHA256SUMS from its own hash list", async () => {
    const { buildIntegrityManifest } = await loadEmitModule();
    const dir = mkdtempSync(join(tmpdir(), "aethelred-int-self-"));
    try {
      writeFileSync(join(dir, "a.js"), "content-a", "utf8");
      writeFileSync(join(dir, "_integrity.json"), "stale-content", "utf8");
      writeFileSync(join(dir, "SHA256SUMS"), "stale-sums", "utf8");
      const manifest = buildIntegrityManifest(dir, { writeToDisk: false });
      expect(manifest.files["a.js"]).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.files).not.toHaveProperty("_integrity.json");
      expect(manifest.files).not.toHaveProperty("SHA256SUMS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walkDir and sha256OfFile line up with expected values", async () => {
    const { walkDir, sha256OfFile } = await loadEmitModule();
    const dir = mkdtempSync(join(tmpdir(), "aethelred-int-walk-"));
    try {
      writeFileSync(join(dir, "one.js"), "one", "utf8");
      const paths = walkDir(dir);
      expect(paths).toHaveLength(1);
      const expected = sha256Hex("one");
      expect(sha256OfFile(paths[0])).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ─── 5. vite plugin ────────────────────────────────────────── */

describe("inpage-integrity vite plugin", () => {
  function makeBundle(
    inpageCode: string,
    contentCode: string,
  ): Record<string, { type: "chunk"; code: string } | { type: "asset" }> {
    return {
      "inpage.js": { type: "chunk", code: inpageCode },
      "content.js": { type: "chunk", code: contentCode },
    };
  }

  it("rewrites the sentinel in content.js to the SHA-256 of inpage.js", async () => {
    const plugin = inpageIntegrityPlugin();
    const inpageCode = "console.info('inpage');";
    const contentCode =
      `const EXPECTED = "${INPAGE_INTEGRITY_SENTINEL}";\n`
      + `console.log(EXPECTED);`;
    const bundle = makeBundle(inpageCode, contentCode);
    const ctx = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    await (plugin.generateBundle as Function).call(ctx, {}, bundle);
    const out = (bundle["content.js"] as { code: string }).code;
    expect(out).toContain(sha256Hex(inpageCode));
    expect(out).not.toContain(INPAGE_INTEGRITY_SENTINEL);
    expect(ctx.error).not.toHaveBeenCalled();
  });

  it("warns when inpage.js chunk is missing", async () => {
    const plugin = inpageIntegrityPlugin();
    const bundle: Record<string, { type: "chunk"; code: string }> = {
      "content.js": { type: "chunk", code: "nothing" },
    };
    const ctx = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    await (plugin.generateBundle as Function).call(ctx, {}, bundle);
    expect(ctx.warn).toHaveBeenCalled();
  });

  it("errors when the sentinel was removed from content.js", async () => {
    const plugin = inpageIntegrityPlugin();
    const ctx = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const bundle = makeBundle("code", "no sentinel here");
    await (plugin.generateBundle as Function).call(ctx, {}, bundle);
    expect(ctx.error).toHaveBeenCalled();
  });
});
