import { beforeAll, describe, expect, it } from "vitest";
import {
  bytesToBase64Url,
  commitPasskeyBindingTransaction,
  evaluatePasskeyBinding,
  verifyWebAuthnAssertion,
  verifyWebAuthnRegistrationContext,
} from "../background/webauthn-verifier";

const RP_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${RP_ID}`;

let privateKey: CryptoKey;
let publicKeySpki: string;
let publicKeyRaw: Uint8Array;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const value = bytes.subarray(start);
  if ((value[0] & 0x80) === 0) return value;
  const padded = new Uint8Array(value.length + 1);
  padded.set(value, 1);
  return padded;
}

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  if (raw[0] === 0x30 && raw.length !== 64) return raw;
  if (raw.length !== 64) throw new Error(`Expected a 64-byte P-256 signature, got ${raw.length}`);
  const r = derInteger(raw.subarray(0, 32));
  const s = derInteger(raw.subarray(32));
  const output = new Uint8Array(6 + r.length + s.length);
  output[0] = 0x30;
  output[1] = output.length - 2;
  output[2] = 0x02;
  output[3] = r.length;
  output.set(r, 4);
  const sOffset = 4 + r.length;
  output[sOffset] = 0x02;
  output[sOffset + 1] = s.length;
  output.set(s, sOffset + 2);
  return output;
}

async function buildAssertion(options?: {
  challenge?: string;
  origin?: string;
  flags?: number;
}) {
  const expectedChallenge = bytesToBase64Url(new Uint8Array(32).fill(0x42));
  const clientData = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.get",
    challenge: options?.challenge ?? expectedChallenge,
    origin: options?.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ORIGIN)),
  );
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = options?.flags ?? 0x05; // user present + user verified
  new DataView(authData.buffer).setUint32(33, 7, false);

  const clientHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(clientData)),
  );
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      toArrayBuffer(signed),
    ),
  );

  return {
    publicKeySpki,
    authenticatorData: bytesToBase64Url(authData),
    clientDataJSON: bytesToBase64Url(clientData),
    signature: bytesToBase64Url(rawSignatureToDer(rawSignature)),
    expectedRpId: ORIGIN,
    expectedChallenge,
    expectedOrigin: ORIGIN,
  };
}

async function buildRegistration(options?: {
  challenge?: string;
  origin?: string;
  credentialId?: Uint8Array;
  flags?: number;
  publicKeySpki?: string;
}) {
  const expectedChallenge = bytesToBase64Url(new Uint8Array(32).fill(0x24));
  const credentialId = options?.credentialId ?? new Uint8Array(32).fill(0xab);
  const clientData = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.create",
    challenge: options?.challenge ?? expectedChallenge,
    origin: options?.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ORIGIN)),
  );
  // Canonical ES256 COSE_Key: {1:2, 3:-7, -1:1, -2:x, -3:y}.
  const coseKey = new Uint8Array(77);
  let coseOffset = 0;
  coseKey[coseOffset++] = 0xa5;
  coseKey.set([0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20], coseOffset);
  coseOffset += 9;
  coseKey.set(publicKeyRaw.subarray(1, 33), coseOffset);
  coseOffset += 32;
  coseKey.set([0x22, 0x58, 0x20], coseOffset);
  coseOffset += 3;
  coseKey.set(publicKeyRaw.subarray(33, 65), coseOffset);

  const authData = new Uint8Array(55 + credentialId.length + coseKey.length);
  authData.set(rpIdHash, 0);
  authData[32] = options?.flags ?? 0x45; // UP + UV + attested credential data
  new DataView(authData.buffer).setUint32(33, 1, false);
  // AAGUID occupies bytes 37..52.
  new DataView(authData.buffer).setUint16(53, credentialId.length, false);
  authData.set(credentialId, 55);
  authData.set(coseKey, 55 + credentialId.length);

  return {
    authenticatorData: bytesToBase64Url(authData),
    clientDataJSON: bytesToBase64Url(clientData),
    credentialId: bytesToBase64Url(credentialId),
    publicKeySpki: options?.publicKeySpki ?? publicKeySpki,
    expectedRpId: ORIGIN,
    expectedChallenge,
    expectedOrigin: ORIGIN,
  };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicKeySpki = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
  );
  publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
});

describe("verifyWebAuthnAssertion", () => {
  it("accepts a challenge-, origin-, RP-, and UV-bound assertion", async () => {
    await expect(verifyWebAuthnAssertion(await buildAssertion())).resolves.toEqual({ signCount: 7 });
  });

  it("rejects a replayed assertion bound to another challenge", async () => {
    const assertion = await buildAssertion({
      challenge: bytesToBase64Url(new Uint8Array(32).fill(0x99)),
    });
    await expect(verifyWebAuthnAssertion(assertion)).rejects.toThrow(/challenge mismatch|replayed/i);
  });

  it("rejects an assertion from another origin", async () => {
    const assertion = await buildAssertion({ origin: "https://phishing.example" });
    await expect(verifyWebAuthnAssertion(assertion)).rejects.toThrow(/origin mismatch/i);
  });

  it("requires user verification, not presence alone", async () => {
    const assertion = await buildAssertion({ flags: 0x01 });
    await expect(verifyWebAuthnAssertion(assertion)).rejects.toThrow(/verification flag/i);
  });

  it("rejects a malformed DER signature before cryptographic verification", async () => {
    const assertion = await buildAssertion();
    assertion.signature = bytesToBase64Url(
      new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00]),
    );
    await expect(verifyWebAuthnAssertion(assertion)).rejects.toThrow(
      /DER signature sequence length/i,
    );
  });
});

describe("verifyWebAuthnRegistrationContext", () => {
  it("binds enrollment to the background challenge, extension origin, RP, UV, and credential id", async () => {
    await expect(
      verifyWebAuthnRegistrationContext(await buildRegistration()),
    ).resolves.toEqual({ signCount: 1, publicKeySpki });
  });

  it("rejects a registration created for another challenge", async () => {
    const registration = await buildRegistration({
      challenge: bytesToBase64Url(new Uint8Array(32).fill(0x99)),
    });
    await expect(
      verifyWebAuthnRegistrationContext(registration),
    ).rejects.toThrow(/challenge mismatch|replayed/i);
  });

  it("rejects a credential id that does not match attested authenticator data", async () => {
    const registration = await buildRegistration();
    registration.credentialId = bytesToBase64Url(new Uint8Array(32).fill(0xcd));
    await expect(
      verifyWebAuthnRegistrationContext(registration),
    ).rejects.toThrow(/credential ID mismatch/i);
  });

  it("rejects an independently supplied SPKI that does not match the attested COSE key", async () => {
    const otherPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const otherSpki = bytesToBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("spki", otherPair.publicKey)),
    );
    await expect(
      verifyWebAuthnRegistrationContext(
        await buildRegistration({ publicKeySpki: otherSpki }),
      ),
    ).rejects.toThrow(/does not match the attested credential key/i);
  });
});

describe("vault passkey binding policy", () => {
  const credential = { subjectId: "subject-a", credentialId: "credential-a" };

  it("fails closed when a required vault has no active identity", () => {
    expect(() => evaluatePasskeyBinding("required", null, [credential])).toThrow(
      /active wallet identity is unavailable/i,
    );
  });

  it("fails closed when the active identity has no bound credential", () => {
    expect(() =>
      evaluatePasskeyBinding("required", "subject-b", [credential]),
    ).toThrow(/no credential is bound to the active wallet identity/i);
  });

  it("does not let a stale password-only marker bypass an orphaned credential", () => {
    expect(() => evaluatePasskeyBinding("none", null, [credential])).toThrow(
      /not bound to the active wallet identity/i,
    );
  });

  it("repairs a stale password-only marker when the credential binding is valid", () => {
    expect(evaluatePasskeyBinding("none", "subject-a", [credential])).toEqual({
      required: true,
      passkeys: [credential],
      policyToPersist: "required",
    });
  });
});

describe("passkey credential/policy persistence", () => {
  function transactionState(initialCredentials: string[], initialPolicy: "required" | "none") {
    let memory = [...initialCredentials];
    let durable = [...initialCredentials];
    let policy: "required" | "none" = initialPolicy;
    let failNextSnapshot = false;
    let failNextRequiredPolicy = false;
    const events: string[] = [];
    return {
      get memory() { return memory; },
      get durable() { return durable; },
      get policy() { return policy; },
      events,
      failSnapshot() { failNextSnapshot = true; },
      failRequiredPolicy() { failNextRequiredPolicy = true; },
      captureSnapshot: () => [...memory],
      restoreSnapshot: (snapshot: string[]) => { memory = [...snapshot]; },
      persistSnapshot: async (snapshot: string[]) => {
        events.push(`credentials:${snapshot.join(",") || "empty"}`);
        if (failNextSnapshot) {
          failNextSnapshot = false;
          throw new Error("credential storage failed");
        }
        durable = [...snapshot];
      },
      setPolicy: async (nextPolicy: "required" | "none") => {
        events.push(`policy:${nextPolicy}`);
        if (nextPolicy === "required" && failNextRequiredPolicy) {
          failNextRequiredPolicy = false;
          throw new Error("policy storage failed");
        }
        policy = nextPolicy;
      },
      enroll: () => {
        memory.push("new-credential");
        return true;
      },
      removeLast: () => {
        memory = [];
        return true;
      },
    };
  }

  it("rolls back enrollment when credential persistence fails without setting required", async () => {
    const state = transactionState([], "none");
    state.failSnapshot();
    await expect(commitPasskeyBindingTransaction({
      previousPolicy: "none",
      targetPolicy: "required",
      captureSnapshot: state.captureSnapshot,
      restoreSnapshot: state.restoreSnapshot,
      persistSnapshot: state.persistSnapshot,
      setPolicy: state.setPolicy,
      mutate: state.enroll,
    })).rejects.toThrow(/credential storage failed/i);

    expect(state.memory).toEqual([]);
    expect(state.durable).toEqual([]);
    expect(state.policy).toBe("none");
    expect(state.events).toEqual(["credentials:new-credential"]);
  });

  it("rolls back the credential when the required-policy write fails", async () => {
    const state = transactionState([], "none");
    state.failRequiredPolicy();
    await expect(commitPasskeyBindingTransaction({
      previousPolicy: "none",
      targetPolicy: "required",
      captureSnapshot: state.captureSnapshot,
      restoreSnapshot: state.restoreSnapshot,
      persistSnapshot: state.persistSnapshot,
      setPolicy: state.setPolicy,
      mutate: state.enroll,
    })).rejects.toThrow(/policy storage failed/i);

    expect(state.memory).toEqual([]);
    expect(state.durable).toEqual([]);
    expect(state.policy).toBe("none");
    expect(state.events).toEqual([
      "credentials:new-credential",
      "policy:required",
      "policy:none",
      "credentials:empty",
    ]);
  });

  it("restores required policy and credential when final-key persistence fails", async () => {
    const state = transactionState(["credential"], "required");
    state.failSnapshot();
    await expect(commitPasskeyBindingTransaction({
      previousPolicy: "required",
      targetPolicy: "none",
      captureSnapshot: state.captureSnapshot,
      restoreSnapshot: state.restoreSnapshot,
      persistSnapshot: state.persistSnapshot,
      setPolicy: state.setPolicy,
      mutate: state.removeLast,
    })).rejects.toThrow(/credential storage failed/i);

    expect(state.memory).toEqual(["credential"]);
    expect(state.durable).toEqual(["credential"]);
    expect(state.policy).toBe("required");
    expect(state.events).toEqual([
      "policy:none",
      "credentials:empty",
      "policy:required",
    ]);
  });

  it("orders successful writes so a crash cannot leave required without a credential", async () => {
    const enrollment = transactionState([], "none");
    await commitPasskeyBindingTransaction({
      previousPolicy: "none",
      targetPolicy: "required",
      captureSnapshot: enrollment.captureSnapshot,
      restoreSnapshot: enrollment.restoreSnapshot,
      persistSnapshot: enrollment.persistSnapshot,
      setPolicy: enrollment.setPolicy,
      mutate: enrollment.enroll,
    });
    expect(enrollment.events).toEqual(["credentials:new-credential", "policy:required"]);

    const removal = transactionState(["credential"], "required");
    await commitPasskeyBindingTransaction({
      previousPolicy: "required",
      targetPolicy: "none",
      captureSnapshot: removal.captureSnapshot,
      restoreSnapshot: removal.restoreSnapshot,
      persistSnapshot: removal.persistSnapshot,
      setPolicy: removal.setPolicy,
      mutate: removal.removeLast,
    });
    expect(removal.events).toEqual(["policy:none", "credentials:empty"]);
  });
});
