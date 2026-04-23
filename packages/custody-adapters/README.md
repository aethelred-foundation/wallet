# `@aethelred/wallet-custody-adapters`

Pluggable signing backends — one `CustodyAdapter` contract, five
concrete implementations, one `asTypedDataSigner()` narrow to hand
into `@aethelred/wallet-x402`.

The x402 client, the MCP server, the intent router, and the smart-
account signer all consume `TypedDataSigner`. This package is the one
place where the signing backend is chosen. Swap the adapter and the
whole stack re-targets — no branches anywhere else.

## Why this package exists

MoltPe's wallet supports two custody modes: managed and 2-of-2 Shamir.
That's the entire menu. Enterprise buyers with hardware-root-of-trust
requirements (fintech, regulated PSPs, agent-fleet operators with TEE-
only compliance postures) can't use either. Our moat is the fact that
every x402 flow can run identically against:

| Tier | Adapter | Key lives in | Moat material? |
| ---- | ------- | ------------ | -------------- |
| Dev baseline | `LocalKeyAdapter` | Process memory | — |
| MoltPe parity | `ShamirTwoOfTwoAdapter` | Split client/coordinator | Parity, not moat |
| Hardware | `LedgerHsmAdapter` | Ledger device | Enterprise table-stakes |
| TEE-rooted | `NitroEnclaveAdapter` | Attested enclave | **The moat** |
| MPC cohort | `FireblocksAdapter` | Fireblocks MPC | Parity, not moat |

The TEE adapter is the one that materially changes what a buyer can
verify. Every x402 payment from a Nitro-rooted agent carries a fresh
TEE quote whose `nonce` binds to the payment's EIP-712 struct hash.
The facilitator / merchant verifies the silicon signature chain,
matches the measurements against the approved code hash, and confirms
the nonce is this payment. MoltPe does not sit inside a TEE. They can
move money safely; they cannot *prove* the code moving it.

## Usage

```ts
import {
  LocalKeyAdapter,
  NitroEnclaveAdapter,
} from "@aethelred/wallet-custody-adapters";
import { createX402Fetch } from "@aethelred/wallet-x402";

// Dev / tests
const local = new LocalKeyAdapter({ privateKey: process.env.PK! });

// Production — attested enclave
const nitro = new NitroEnclaveAdapter({
  transport: myEnclaveTransport, // vsock / HTTPS-mTLS / gRPC
  attestOnSign: true,             // bind a fresh quote per payment
});
await nitro.initialize();

// Either adapter plugs into the same x402 client.
const fetchX402 = createX402Fetch({
  signer: nitro.asTypedDataSigner(),
  attestationProvider: nitro,      // for the moat path
});
```

## The shared EIP-712 digest

`computeTypedDataDigest()` is exported separately and is what every
adapter uses to reduce a `TypedDataRequest` to the 32-byte digest that
`secp256k1.sign()` consumes. Having a single shared implementation is
a cryptographic invariant: a signature from `LocalKeyAdapter` MUST
recover to the same address as a signature from `NitroEnclaveAdapter`
for the same request + key material. If the hash drifts, you get a
field-corruption bug that no test catches until a real customer's
merchant rejects a payment.

## Errors

All adapters throw `CustodyError` with a stable `code`. Callers
(x402 client, MCP server, intent router) branch on `code` — never on
`message`, which is for humans.

Codes in this package:

- User/policy: `user-rejected`, `session-locked`, `spend-policy-violation`
- Hardware/TEE: `device-not-connected`, `device-busy`, `device-app-not-open`, `firmware-too-old`, `attestation-failed`, `enclave-unreachable`
- Key material: `invalid-key-material`, `key-share-missing`, `shamir-reconstruction-failed`
- Capability/config: `capability-not-supported`, `adapter-disposed`, `adapter-config-invalid`
- Signing: `signing-failed`, `signature-malformed`, `chain-id-mismatch`
- Network: `remote-api-error`, `remote-api-timeout`

## What each adapter does NOT do

- **`LocalKeyAdapter`** — does not persist keys, does not sign raw
  transactions (deferred to `@aethelred/wallet-core` custody). It is
  a reference, a baseline, and a test fixture.
- **`ShamirTwoOfTwoAdapter`** — does not perform network I/O itself;
  you plug a `ShareFetcher`. Does not cache shares across calls
  (that would defeat split custody).
- **`NitroEnclaveAdapter`** — does not speak the enclave wire protocol
  itself; you plug an `EnclaveTransport`. Does not verify attestation
  signature chains (that is the responsibility of the TEE verifier in
  `@aethelred/wallet-compliance`).
- **`LedgerHsmAdapter`** — does not manage WebHID connection
  lifecycle; you construct it around an already-connected
  `HardwareWalletBackend`.
- **`FireblocksAdapter`** — does not ship production-grade JWT auth or
  retry/backoff logic. Wire those into your `FireblocksClient`
  implementation before production use.

## Testing

Tests live in `apps/extension/src/test/custody-adapters.test.ts` and
cover: the shared EIP-712 hash (golden fixture + cross-chain replay
check), each adapter's happy path (signatures recover to the
adapter's address), capability gates, error translation, zeroization
on dispose, and Nitro's defense-in-depth signature-recovery check.

```bash
npx vitest run custody-adapters
```
