/**
 * WebAuthn assertion verification shared by unlock and future
 * transaction-confirmation ceremonies.
 *
 * The verifier is deliberately strict: an assertion is accepted only when it
 * is bound to the one-time challenge issued by the background service worker,
 * the extension origin, the enrolled RP ID, and explicit user verification.
 */

export interface WebAuthnAssertionVerificationOptions {
  publicKeySpki: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  expectedRpId: string;
  expectedChallenge: string;
  expectedOrigin: string;
  requireUserVerification?: boolean;
}

export interface WebAuthnAssertionVerificationResult {
  signCount: number;
}

export interface WebAuthnRegistrationVerificationOptions {
  authenticatorData: string;
  clientDataJSON: string;
  credentialId: string;
  /**
   * SPKI reported by AuthenticatorAttestationResponse.getPublicKey(). It is
   * accepted only when it represents the same P-256 point as the COSE key
   * embedded in authenticatorData.
   */
  publicKeySpki: string;
  expectedRpId: string;
  expectedChallenge: string;
  expectedOrigin: string;
}

export interface WebAuthnRegistrationVerificationResult {
  signCount: number;
  /** Canonical SPKI derived from the attested COSE public key. */
  publicKeySpki: string;
}

export type DurablePasskeyPolicy = "required" | "none" | "unknown";

/**
 * Result of reconciling the vault-level policy with subject-scoped passkeys.
 * `policyToPersist` is a monotonic repair for legacy records: an existing
 * credential always upgrades the vault to required, while an empty legacy
 * vault gets an explicit password-only marker.
 */
export interface PasskeyBindingResolution<TPasskey> {
  required: boolean;
  passkeys: TPasskey[];
  policyToPersist: "required" | "none" | null;
}

/**
 * Reconcile a durable vault policy with the active identity binding.
 *
 * A required policy is never weakened because identity state is missing. A
 * legacy/stale `none` marker also cannot bypass an existing credential: the
 * credential wins and the durable policy is repaired to `required`.
 */
export function evaluatePasskeyBinding<TPasskey extends { subjectId: string }>(
  policy: DurablePasskeyPolicy,
  activeSubjectId: string | null,
  allPasskeys: readonly TPasskey[],
): PasskeyBindingResolution<TPasskey> {
  const matchingPasskeys = activeSubjectId
    ? allPasskeys.filter((passkey) => passkey.subjectId === activeSubjectId)
    : [];

  if (policy === "required") {
    if (!activeSubjectId) {
      throw new Error(
        "Passkey protection is enabled but the active wallet identity is unavailable; restore this wallet with its recovery phrase",
      );
    }
    if (matchingPasskeys.length === 0) {
      throw new Error(
        "Passkey protection is enabled but no credential is bound to the active wallet identity; restore this wallet with its recovery phrase",
      );
    }
    return { required: true, passkeys: matchingPasskeys, policyToPersist: null };
  }

  if (allPasskeys.length > 0) {
    if (!activeSubjectId || matchingPasskeys.length === 0) {
      throw new Error(
        "Stored passkey credentials are not bound to the active wallet identity; restore this wallet with its recovery phrase",
      );
    }
    return {
      required: true,
      passkeys: matchingPasskeys,
      policyToPersist: "required",
    };
  }

  return {
    required: false,
    passkeys: [],
    policyToPersist: policy === "unknown" ? "none" : null,
  };
}

export interface PasskeyBindingTransactionOptions<TSnapshot, TResult> {
  previousPolicy: DurablePasskeyPolicy;
  targetPolicy: "required" | "none";
  captureSnapshot: () => TSnapshot;
  restoreSnapshot: (snapshot: TSnapshot) => void;
  mutate: () => TResult;
  persistSnapshot: (snapshot: TSnapshot) => Promise<void>;
  setPolicy: (policy: "required" | "none") => Promise<void>;
}

function rollbackFailure(operationError: unknown, rollbackError: unknown): Error {
  const operationMessage = operationError instanceof Error
    ? operationError.message
    : String(operationError);
  const rollbackMessage = rollbackError instanceof Error
    ? rollbackError.message
    : String(rollbackError);
  return new Error(
    `Passkey update failed (${operationMessage}) and rollback also failed (${rollbackMessage}); wallet remains fail-closed`,
    { cause: operationError },
  );
}

/**
 * Persist a credential/policy change in an order that preserves the security
 * invariant across MV3 worker termination:
 *
 * - enabling: credential snapshot first, then `required` policy;
 * - disabling the last key: `none` policy first, then credential snapshot.
 *
 * A crash between those writes can leave `none + credential`, which
 * `evaluatePasskeyBinding` upgrades back to required. It can never create the
 * unrecoverable `required + no credential` combination.
 */
export async function commitPasskeyBindingTransaction<TSnapshot, TResult>(
  options: PasskeyBindingTransactionOptions<TSnapshot, TResult>,
): Promise<TResult> {
  const previousSnapshot = options.captureSnapshot();
  let result: TResult;
  try {
    result = options.mutate();
  } catch (error) {
    options.restoreSnapshot(previousSnapshot);
    throw error;
  }
  const nextSnapshot = options.captureSnapshot();

  if (options.targetPolicy === "required") {
    try {
      await options.persistSnapshot(nextSnapshot);
    } catch (error) {
      options.restoreSnapshot(previousSnapshot);
      throw error;
    }

    try {
      await options.setPolicy("required");
    } catch (error) {
      // A failed policy write may have an indeterminate outcome. If the prior
      // vault was password-only, first force it back to `none`; only then is
      // it safe to remove the newly-persisted credential.
      try {
        if (options.previousPolicy !== "required") {
          await options.setPolicy("none");
        }
        await options.persistSnapshot(previousSnapshot);
        options.restoreSnapshot(previousSnapshot);
      } catch (rollbackError) {
        // Keep the new credential in memory and storage. Whether the failed
        // policy write landed or not, the vault cannot become required with
        // no usable key; reconciliation will require/repair it on next use.
        options.restoreSnapshot(nextSnapshot);
        throw rollbackFailure(error, rollbackError);
      }
      throw error;
    }
    return result;
  }

  // Removing the final credential reverses the order: clear the durable
  // requirement before persisting a credential-less snapshot.
  try {
    await options.setPolicy("none");
  } catch (error) {
    options.restoreSnapshot(previousSnapshot);
    throw error;
  }
  try {
    await options.persistSnapshot(nextSnapshot);
  } catch (error) {
    options.restoreSnapshot(previousSnapshot);
    try {
      await options.setPolicy(
        options.previousPolicy === "required" ? "required" : "none",
      );
    } catch (rollbackError) {
      throw rollbackFailure(error, rollbackError);
    }
    throw error;
  }
  return result;
}

/** Encode bytes as unpadded base64url. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode an unpadded base64url value. Invalid input is rejected. */
export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function readDerLength(
  der: Uint8Array,
  offset: number,
): { length: number; nextOffset: number } {
  if (offset >= der.length) throw new Error("Invalid DER signature length");
  const first = der[offset];
  if ((first & 0x80) === 0) return { length: first, nextOffset: offset + 1 };

  const octets = first & 0x7f;
  if (octets === 0 || octets > 2 || offset + octets >= der.length) {
    throw new Error("Invalid DER signature length");
  }
  let length = 0;
  for (let i = 0; i < octets; i += 1) {
    length = (length << 8) | der[offset + 1 + i];
  }
  if (length < 128 || (octets > 1 && der[offset + 1] === 0)) {
    throw new Error("Non-canonical DER signature length");
  }
  return { length, nextOffset: offset + 1 + octets };
}

function normalizeDerInteger(value: Uint8Array): Uint8Array {
  if (value.length === 0 || (value[0] & 0x80) !== 0) {
    throw new Error("DER signature INTEGER must be positive");
  }
  if (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) {
    throw new Error("Non-canonical DER signature INTEGER padding");
  }
  if (value.length === 33) {
    if (value[0] !== 0 || (value[1] & 0x80) === 0) {
      throw new Error("Invalid DER signature INTEGER padding");
    }
    return value.subarray(1);
  }
  if (value.length > 32) {
    throw new Error("DER signature integer larger than 32 bytes");
  }
  return value;
}

/** Convert a strict ASN.1 DER ECDSA signature to IEEE-P1363 r||s. */
function derEcdsaToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error("Invalid DER signature (expected SEQUENCE)");
  }
  const sequence = readDerLength(der, 1);
  if (sequence.nextOffset + sequence.length !== der.length) {
    throw new Error("Invalid DER signature sequence length");
  }

  let offset = sequence.nextOffset;
  if (der[offset] !== 0x02) {
    throw new Error("Invalid DER signature (expected INTEGER for r)");
  }
  const rLength = readDerLength(der, offset + 1);
  let r = der.subarray(rLength.nextOffset, rLength.nextOffset + rLength.length);
  offset = rLength.nextOffset + rLength.length;

  if (offset >= der.length || der[offset] !== 0x02) {
    throw new Error("Invalid DER signature (expected INTEGER for s)");
  }
  const sLength = readDerLength(der, offset + 1);
  let s = der.subarray(sLength.nextOffset, sLength.nextOffset + sLength.length);
  offset = sLength.nextOffset + sLength.length;
  if (offset !== der.length || r.length === 0 || s.length === 0) {
    throw new Error("Invalid DER signature payload");
  }

  r = normalizeDerInteger(r);
  s = normalizeDerInteger(s);

  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

async function assertRpIdHash(
  authenticatorData: Uint8Array,
  expectedRpId: string,
): Promise<void> {
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(expectedRpId),
    ),
  );
  if (!constantTimeEqual(authenticatorData.subarray(0, 32), expectedRpIdHash)) {
    throw new Error("RP ID hash mismatch — credential for a different relying party");
  }
}

function parseAndVerifyClientData(
  encodedClientData: string,
  expectedType: "webauthn.create" | "webauthn.get",
  expectedChallenge: string,
  expectedOrigin: string,
): Uint8Array {
  const clientData = base64UrlToBytes(encodedClientData);
  let client: {
    type?: unknown;
    challenge?: unknown;
    origin?: unknown;
    crossOrigin?: unknown;
  };
  try {
    client = JSON.parse(new TextDecoder().decode(clientData)) as typeof client;
  } catch {
    throw new Error("clientDataJSON is not valid JSON");
  }
  if (client.type !== expectedType) {
    throw new Error(`Unexpected clientDataJSON.type: ${String(client.type)}`);
  }
  if (typeof client.challenge !== "string") {
    throw new Error("clientDataJSON challenge missing");
  }
  if (
    !constantTimeEqual(
      base64UrlToBytes(client.challenge),
      base64UrlToBytes(expectedChallenge),
    )
  ) {
    throw new Error("WebAuthn challenge mismatch or replayed ceremony");
  }
  if (client.origin !== expectedOrigin) {
    throw new Error("WebAuthn origin mismatch");
  }
  if (client.crossOrigin === true) {
    throw new Error("Cross-origin WebAuthn ceremonies are not accepted");
  }
  return clientData;
}

interface CborHeader {
  major: number;
  value: number;
  nextOffset: number;
}

function readCborHeader(data: Uint8Array, offset: number): CborHeader {
  if (offset >= data.length) throw new Error("Attested COSE public key is truncated");
  const initial = data[offset];
  const major = initial >>> 5;
  const additional = initial & 0x1f;
  if (additional < 24) return { major, value: additional, nextOffset: offset + 1 };
  if (additional === 31) {
    throw new Error("Indefinite-length CBOR is not accepted for the attested public key");
  }

  const byteLength = additional === 24
    ? 1
    : additional === 25
      ? 2
      : additional === 26
        ? 4
        : 0;
  if (byteLength === 0 || offset + 1 + byteLength > data.length) {
    throw new Error("Unsupported or truncated CBOR length in attested public key");
  }
  const view = new DataView(data.buffer, data.byteOffset + offset + 1, byteLength);
  const value = byteLength === 1
    ? view.getUint8(0)
    : byteLength === 2
      ? view.getUint16(0, false)
      : view.getUint32(0, false);
  return { major, value, nextOffset: offset + 1 + byteLength };
}

function readCborInteger(
  data: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  const header = readCborHeader(data, offset);
  if (header.major === 0) return { value: header.value, nextOffset: header.nextOffset };
  if (header.major === 1) return { value: -1 - header.value, nextOffset: header.nextOffset };
  throw new Error("Attested COSE public key contains a non-integer label or parameter");
}

function readCborByteString(
  data: Uint8Array,
  offset: number,
): { value: Uint8Array; nextOffset: number } {
  const header = readCborHeader(data, offset);
  if (header.major !== 2 || header.nextOffset + header.value > data.length) {
    throw new Error("Attested COSE public key coordinate is malformed");
  }
  return {
    value: data.subarray(header.nextOffset, header.nextOffset + header.value),
    nextOffset: header.nextOffset + header.value,
  };
}

function skipCborValue(data: Uint8Array, offset: number, depth = 0): number {
  if (depth > 8) throw new Error("Attested COSE public key CBOR nesting is excessive");
  const header = readCborHeader(data, offset);
  if (header.major === 0 || header.major === 1 || header.major === 7) {
    return header.nextOffset;
  }
  if (header.major === 2 || header.major === 3) {
    const end = header.nextOffset + header.value;
    if (end > data.length) throw new Error("Attested COSE public key is truncated");
    return end;
  }
  if (header.major === 4) {
    let cursor = header.nextOffset;
    for (let index = 0; index < header.value; index += 1) {
      cursor = skipCborValue(data, cursor, depth + 1);
    }
    return cursor;
  }
  if (header.major === 5) {
    let cursor = header.nextOffset;
    for (let index = 0; index < header.value; index += 1) {
      cursor = skipCborValue(data, cursor, depth + 1);
      cursor = skipCborValue(data, cursor, depth + 1);
    }
    return cursor;
  }
  if (header.major === 6) {
    return skipCborValue(data, header.nextOffset, depth + 1);
  }
  throw new Error("Attested COSE public key contains an unsupported CBOR value");
}

function parseCoseP256PublicKey(authData: Uint8Array, offset: number): Uint8Array {
  const map = readCborHeader(authData, offset);
  if (map.major !== 5 || map.value < 5 || map.value > 16) {
    throw new Error("Attested credential public key is not a valid COSE key map");
  }

  let cursor = map.nextOffset;
  let kty: number | undefined;
  let alg: number | undefined;
  let curve: number | undefined;
  let x: Uint8Array | undefined;
  let y: Uint8Array | undefined;
  const seenLabels = new Set<number>();

  for (let index = 0; index < map.value; index += 1) {
    const label = readCborInteger(authData, cursor);
    cursor = label.nextOffset;
    if (seenLabels.has(label.value)) {
      throw new Error("Attested COSE public key contains duplicate parameters");
    }
    seenLabels.add(label.value);

    if (label.value === 1 || label.value === 3 || label.value === -1) {
      const parameter = readCborInteger(authData, cursor);
      cursor = parameter.nextOffset;
      if (label.value === 1) kty = parameter.value;
      else if (label.value === 3) alg = parameter.value;
      else curve = parameter.value;
      continue;
    }
    if (label.value === -2 || label.value === -3) {
      const coordinate = readCborByteString(authData, cursor);
      cursor = coordinate.nextOffset;
      if (label.value === -2) x = coordinate.value;
      else y = coordinate.value;
      continue;
    }
    cursor = skipCborValue(authData, cursor);
  }

  // COSE: kty 2 = EC2, alg -7 = ES256, crv 1 = P-256.
  if (kty !== 2 || alg !== -7 || curve !== 1 || x?.length !== 32 || y?.length !== 32) {
    throw new Error("Attested credential must contain an ES256 P-256 public key");
  }
  const rawPoint = new Uint8Array(65);
  rawPoint[0] = 0x04;
  rawPoint.set(x, 1);
  rawPoint.set(y, 33);
  return rawPoint;
}

async function verifyAndCanonicalizeAttestedPublicKey(
  authData: Uint8Array,
  coseOffset: number,
  suppliedSpki: string,
): Promise<string> {
  const attestedRawPoint = parseCoseP256PublicKey(authData, coseOffset);
  const attestedKey = await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(attestedRawPoint),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );

  let suppliedKey: CryptoKey;
  try {
    suppliedKey = await crypto.subtle.importKey(
      "spki",
      bytesToArrayBuffer(base64UrlToBytes(suppliedSpki)),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
  } catch {
    throw new Error("Registration public key SPKI is malformed");
  }
  const suppliedRawPoint = new Uint8Array(
    await crypto.subtle.exportKey("raw", suppliedKey),
  );
  if (!constantTimeEqual(attestedRawPoint, suppliedRawPoint)) {
    throw new Error("Registration public key does not match the attested credential key");
  }

  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("spki", attestedKey)),
  );
}

/** Verify the background-issued challenge and authenticator binding at enrollment. */
export async function verifyWebAuthnRegistrationContext(
  options: WebAuthnRegistrationVerificationOptions,
): Promise<WebAuthnRegistrationVerificationResult> {
  const authData = base64UrlToBytes(options.authenticatorData);
  if (authData.length < 55) {
    throw new Error("Registration authenticatorData is too short");
  }
  await assertRpIdHash(authData, options.expectedRpId);
  const flags = authData[32];
  if ((flags & 0x01) === 0) throw new Error("User presence flag not set");
  if ((flags & 0x04) === 0) throw new Error("User verification flag not set");
  if ((flags & 0x40) === 0) throw new Error("Attested credential data flag not set");

  parseAndVerifyClientData(
    options.clientDataJSON,
    "webauthn.create",
    options.expectedChallenge,
    options.expectedOrigin,
  );

  const credentialLength = new DataView(
    authData.buffer,
    authData.byteOffset + 53,
    2,
  ).getUint16(0, false);
  const credentialStart = 55;
  if (credentialLength === 0 || credentialStart + credentialLength > authData.length) {
    throw new Error("Registration credential ID is malformed");
  }
  const attestedCredentialId = authData.subarray(
    credentialStart,
    credentialStart + credentialLength,
  );
  if (!constantTimeEqual(attestedCredentialId, base64UrlToBytes(options.credentialId))) {
    throw new Error("Registration credential ID mismatch");
  }

  const publicKeySpki = await verifyAndCanonicalizeAttestedPublicKey(
    authData,
    credentialStart + credentialLength,
    options.publicKeySpki,
  );

  const signCount = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4,
  ).getUint32(0, false);
  return { signCount, publicKeySpki };
}

/**
 * Verify a WebAuthn authentication assertion according to WebAuthn §7.2.
 */
export async function verifyWebAuthnAssertion(
  options: WebAuthnAssertionVerificationOptions,
): Promise<WebAuthnAssertionVerificationResult> {
  const authData = base64UrlToBytes(options.authenticatorData);
  const clientData = base64UrlToBytes(options.clientDataJSON);
  const signature = base64UrlToBytes(options.signature);
  const spki = base64UrlToBytes(options.publicKeySpki);

  if (authData.length < 37) {
    throw new Error("authenticatorData too short (need at least 37 bytes)");
  }

  const flags = authData[32];
  const signCount = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4,
  ).getUint32(0, false);

  await assertRpIdHash(authData, options.expectedRpId);
  if ((flags & 0x01) === 0) throw new Error("User presence flag not set");
  if (options.requireUserVerification !== false && (flags & 0x04) === 0) {
    throw new Error("User verification flag not set");
  }

  parseAndVerifyClientData(
    options.clientDataJSON,
    "webauthn.get",
    options.expectedChallenge,
    options.expectedOrigin,
  );

  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytesToArrayBuffer(clientData)),
  );
  const signedData = new Uint8Array(authData.length + clientDataHash.length);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.length);

  const publicKey = await crypto.subtle.importKey(
    "spki",
    bytesToArrayBuffer(spki),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    bytesToArrayBuffer(derEcdsaToRaw(signature)),
    bytesToArrayBuffer(signedData),
  );
  if (!valid) throw new Error("ECDSA signature verification failed");

  return { signCount };
}
