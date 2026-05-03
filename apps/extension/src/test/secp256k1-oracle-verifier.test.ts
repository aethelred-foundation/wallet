/**
 * Tests for `Secp256k1OracleSignatureVerifier` — the production-grade
 * oracle signature verifier added in this PR.
 *
 * Coverage targets:
 *
 *   1. Happy path — valid signature against pinned key → true
 *   2. Per-oracle key pinning isolates verification correctly:
 *      - Unknown oracleId → false
 *      - Right signature on WRONG oracleId (whose pin is a different
 *        key) → false (no key-swap attacks)
 *   3. Multiple keys per oracleId for rotation windows → both work
 *   4. Tamper detection: same signature, mutated payload → false
 *   5. Signature format flexibility: 64-byte compact, 65-byte
 *      Ethereum-style (with recovery byte) — both verify the same
 *   6. Public key format flexibility: compressed, uncompressed,
 *      raw 64-byte uncompressed (no prefix) — all accepted
 *   7. Malformed inputs → false (never throw):
 *      - Bad hex signature, wrong-length signature, malformed key,
 *      - Hash function throws (custom hashFn) → false
 *   8. Custom hash function (keccak256-style override) works
 *   9. End-to-end composition with `JsonFeedLiabilityAttestor`
 */

import { describe, expect, it } from "vitest";

import * as secp256k1 from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  CUSTODIAN_IDS,
  JsonFeedLiabilityAttestor,
  Secp256k1OracleSignatureVerifier,
  captureLiabilitySnapshot,
} from "@aethelred/wallet-custody-adapters";

// ─── Helpers ──────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): `0x${string}` {
  return ("0x" +
    Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function makeOracleKeypair(seed: number): {
  readonly privateKey: Uint8Array;
  readonly publicKeyCompressed: Uint8Array;
  readonly publicKeyUncompressed: Uint8Array;
} {
  // Deterministic 32-byte private key from a tiny seed.
  const priv = new Uint8Array(32);
  priv[31] = seed; // last byte is the seed; rest are zero
  return {
    privateKey: priv,
    publicKeyCompressed: secp256k1.getPublicKey(priv, true),
    publicKeyUncompressed: secp256k1.getPublicKey(priv, false),
  };
}

function signPayload(
  privateKey: Uint8Array,
  payload: Uint8Array,
  hash: (b: Uint8Array) => Uint8Array = sha256,
): {
  readonly compactHex: `0x${string}`;
  readonly ethStyleHex: `0x${string}`;
} {
  const digest = hash(payload);
  const sig = secp256k1.sign(digest, privateKey, { lowS: true });
  const compact = sig.toCompactRawBytes();
  const v = 27 + (sig.recovery ?? 0);
  const ethStyle = new Uint8Array(65);
  ethStyle.set(compact, 0);
  ethStyle[64] = v;
  return {
    compactHex: bytesToHex(compact),
    ethStyleHex: bytesToHex(ethStyle),
  };
}

const PAYLOAD = new TextEncoder().encode(
  '{"custodianId":"komainu","slaStatus":"operational","insuranceCoverage":"50000000000n"}',
);

// ─── Happy path + format flexibility ─────────────────────────────

describe("Secp256k1OracleSignatureVerifier: happy path", () => {
  it("accepts a valid signature against a pinned compressed public key", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        ["chainlink:custody:komainu", [kp.publicKeyCompressed]],
      ]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "chainlink:custody:komainu",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
  });

  it("accepts a valid signature against a pinned uncompressed key", () => {
    const kp = makeOracleKeypair(2);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyUncompressed]]]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
  });

  it("accepts a raw 64-byte uncompressed key (re-prefixes internally)", () => {
    const kp = makeOracleKeypair(3);
    // Strip the 0x04 prefix to simulate a raw 64-byte key from a
    // legacy oracle config.
    const raw64 = kp.publicKeyUncompressed.subarray(1);
    expect(raw64.length).toBe(64);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [raw64]]]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
  });

  it("accepts hex-string pinned keys (with and without 0x prefix)", () => {
    const kp = makeOracleKeypair(4);
    const hex = bytesToHex(kp.publicKeyCompressed);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        ["o1", [hex, hex.slice(2)]], // both forms
      ]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
  });

  it("accepts 65-byte Ethereum-style signatures (strips recovery byte)", () => {
    const kp = makeOracleKeypair(5);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    // Ethereum-style includes the recovery byte; verifier strips it.
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.ethStyleHex,
      }),
    ).toBe(true);
  });
});

// ─── Per-oracle pinning ────────────────────────────────────────────

describe("Secp256k1OracleSignatureVerifier: per-oracle key pinning", () => {
  it("returns false when oracleId has no pinned key (fail-closed)", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["known-oracle", [kp.publicKeyCompressed]]]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "unknown-oracle",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(false);
  });

  it("rejects valid signature on the WRONG oracleId (no key-swap attack)", () => {
    // Attacker scenario: oracle A's key signed payload P. Attacker
    // claims `oracleId: B` (which has a different pinned key). The
    // verifier must reject because the oracleId-A signature doesn't
    // match the oracleId-B pin.
    const kpA = makeOracleKeypair(1);
    const kpB = makeOracleKeypair(2);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        ["oracle-A", [kpA.publicKeyCompressed]],
        ["oracle-B", [kpB.publicKeyCompressed]],
      ]),
    });
    const sigByA = signPayload(kpA.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "oracle-B",
        payload: PAYLOAD,
        signature: sigByA.compactHex,
      }),
    ).toBe(false);
  });

  it("supports multiple keys per oracleId (rotation window)", () => {
    // Realistic config: during rotation, the verifier accepts both
    // the old key (still attesting in-flight snapshots) AND the new
    // key (fresh snapshots) for the same oracleId. After rotation
    // completes, operators remove the old key from the pin map.
    const oldKey = makeOracleKeypair(1);
    const newKey = makeOracleKeypair(2);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        ["o1", [oldKey.publicKeyCompressed, newKey.publicKeyCompressed]],
      ]),
    });
    const oldSig = signPayload(oldKey.privateKey, PAYLOAD);
    const newSig = signPayload(newKey.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: oldSig.compactHex,
      }),
    ).toBe(true);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: newSig.compactHex,
      }),
    ).toBe(true);
  });

  it("rejects signatures from a third key not in the rotation window", () => {
    const oldKey = makeOracleKeypair(1);
    const newKey = makeOracleKeypair(2);
    const attacker = makeOracleKeypair(99);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        ["o1", [oldKey.publicKeyCompressed, newKey.publicKeyCompressed]],
      ]),
    });
    const sigByAttacker = signPayload(attacker.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sigByAttacker.compactHex,
      }),
    ).toBe(false);
  });
});

// ─── Tamper detection ─────────────────────────────────────────────

describe("Secp256k1OracleSignatureVerifier: tamper detection", () => {
  it("rejects when the payload is mutated even by one byte", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    const tampered = new Uint8Array(PAYLOAD);
    tampered[0] ^= 0x01;
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: tampered,
        signature: sig.compactHex,
      }),
    ).toBe(false);
  });
});

// ─── Malformed inputs (never throw) ───────────────────────────────

describe("Secp256k1OracleSignatureVerifier: malformed inputs (never throw)", () => {
  it("malformed signature (non-hex characters) → false", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
    });
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: "0xZZZZ" as `0x${string}`,
      }),
    ).toBe(false);
  });

  it("wrong-length signature (32 bytes) → false", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
    });
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: ("0x" + "00".repeat(32)) as `0x${string}`,
      }),
    ).toBe(false);
  });

  it("malformed pinned key (random bytes) → quietly dropped at construction; verify returns false", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([
        // First entry is malformed; second entry is valid. Verifier
        // should drop the malformed pin during construction and still
        // accept the second key.
        ["o1", [new Uint8Array(50), kp.publicKeyCompressed]],
        ["o-only-malformed", [new Uint8Array(50)]],
      ]),
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
    // For an oracleId with ONLY malformed pins, fail-closed.
    expect(
      verifier.verify({
        oracleId: "o-only-malformed",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(false);
  });

  it("hash function that throws → false", () => {
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
      hash: () => {
        throw new Error("hash crashed");
      },
    });
    const sig = signPayload(kp.privateKey, PAYLOAD);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(false);
  });
});

// ─── Custom hash function ────────────────────────────────────────

describe("Secp256k1OracleSignatureVerifier: custom hash function", () => {
  it("verifies signatures produced over an alternate hash (not sha256)", () => {
    // Some oracles sign over a hash other than sha256 — e.g.,
    // keccak256, or a domain-tagged sha256. The verifier accepts a
    // custom hash function so operators can match the oracle's
    // signing scheme.
    const customHash = (input: Uint8Array): Uint8Array => {
      // Trivially-distinct hash: sha256 of "tagged" || input.
      const tagged = new Uint8Array(6 + input.length);
      tagged.set(new TextEncoder().encode("tagged"), 0);
      tagged.set(input, 6);
      return sha256(tagged);
    };

    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
      hash: customHash,
    });
    // Sign with the SAME custom hash so the verifier will accept it.
    const sig = signPayload(kp.privateKey, PAYLOAD, customHash);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sig.compactHex,
      }),
    ).toBe(true);
  });

  it("rejects sha256 signature when verifier expects custom hash (no cross-hash forgery)", () => {
    const customHash = (input: Uint8Array): Uint8Array => {
      const tagged = new Uint8Array(6 + input.length);
      tagged.set(new TextEncoder().encode("tagged"), 0);
      tagged.set(input, 6);
      return sha256(tagged);
    };
    const kp = makeOracleKeypair(1);
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([["o1", [kp.publicKeyCompressed]]]),
      hash: customHash,
    });
    // Sign over plain sha256 — verifier expects customHash → reject.
    const sigSha = signPayload(kp.privateKey, PAYLOAD, sha256);
    expect(
      verifier.verify({
        oracleId: "o1",
        payload: PAYLOAD,
        signature: sigSha.compactHex,
      }),
    ).toBe(false);
  });
});

// ─── End-to-end composition with JsonFeedLiabilityAttestor ───────

describe("Secp256k1OracleSignatureVerifier: end-to-end with JsonFeedLiabilityAttestor", () => {
  it("verifies a snapshot fetched from a JSON feed", async () => {
    const kp = makeOracleKeypair(1);
    const oracleId = "chainlink:custody:komainu";
    const NOW = 1_700_000_000_500;

    // Build the JSON body. JsonFeedLiabilityAttestor signs the
    // CANONICAL form of the attestation EXCLUDING signature, so we
    // mirror that here when generating the test signature.
    const payloadObj = {
      attestedAt: 1_700_000_000_000,
      custodianId: CUSTODIAN_IDS.komainu,
      insuranceCoverage: "50000000000n",
      insuranceCurrency: "USD",
      oracleId,
      slaStatus: "operational",
    };
    // The attestor's canonical serializer sorts keys alphabetically.
    // We replicate that here via JSON.stringify with sorted keys.
    const canonical = `{${Object.keys(payloadObj)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${JSON.stringify(
            (payloadObj as Record<string, unknown>)[k],
          )}`,
      )
      .join(",")}}`;
    const signaturePayload = new TextEncoder().encode(canonical);
    const sig = signPayload(kp.privateKey, signaturePayload);

    const feedJson = JSON.stringify({
      ...payloadObj,
      signature: sig.compactHex,
    });

    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([[oracleId, [kp.publicKeyCompressed]]]),
    });

    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier,
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => feedJson,
      }),
      now: () => NOW,
    });

    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor,
      now: () => NOW,
    });
    // Verification passed → liabilityUnknown=false, attestation present.
    expect(snapshot.liabilityUnknown).toBe(false);
    expect(snapshot.attestation!.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("rejects (snapshot=null, liabilityUnknown=true) when signature fails verification", async () => {
    const realKp = makeOracleKeypair(1);
    const attackerKp = makeOracleKeypair(99);
    const oracleId = "chainlink:custody:komainu";
    const NOW = 1_700_000_000_500;

    // Sign with attacker key but pin only the real key.
    const payloadObj = {
      attestedAt: 1_700_000_000_000,
      custodianId: CUSTODIAN_IDS.komainu,
      insuranceCoverage: "50000000000n",
      insuranceCurrency: "USD",
      oracleId,
      slaStatus: "operational",
    };
    const canonical = `{${Object.keys(payloadObj)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${JSON.stringify(
            (payloadObj as Record<string, unknown>)[k],
          )}`,
      )
      .join(",")}}`;
    const sig = signPayload(
      attackerKp.privateKey,
      new TextEncoder().encode(canonical),
    );
    const feedJson = JSON.stringify({
      ...payloadObj,
      signature: sig.compactHex,
    });

    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([[oracleId, [realKp.publicKeyCompressed]]]),
    });

    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier,
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => feedJson,
      }),
      now: () => NOW,
    });

    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor,
      now: () => NOW,
    });
    // Verification failed → null attestation → liabilityUnknown=true.
    // Audit chain still records the gap. Transaction still proceeds.
    expect(snapshot.liabilityUnknown).toBe(true);
    expect(snapshot.attestation).toBeNull();
  });
});
