# @aethelred/wallet-x402

**x402 (HTTP 402 Payment Required) protocol client + facilitator, bound to TEE-attested agent identity.**

## What makes this different from Coinbase's x402 SDK

Vanilla x402 proves *a wallet holds funds + signed consent to pay*. This package adds a wire-backwards-compatible extension that additionally proves *the payment was authored by an agent running approved code inside approved silicon, and proves it in a way that cannot be separated from the payment itself*.

```
┌─────────────────────────────────────────────────────────────┐
│                     Vanilla x402                            │
│   X-PAYMENT: <signed EIP-3009 auth>                         │
│   → Receiver knows: this wallet signed to pay.              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│            x402 + Aethelred TEE binding                     │
│   X-PAYMENT: <signed EIP-3009 auth>                         │
│   X-PAYMENT-ATTESTATION: <TEE quote + bindingHash>          │
│   bindingHash = sha256(structHash ‖ sha256(quote))          │
│   → Receiver knows: this SPECIFIC payment was authored by   │
│     an agent running SPECIFIC code inside SPECIFIC silicon, │
│     and the two cannot be separated.                        │
└─────────────────────────────────────────────────────────────┘
```

A vanilla x402 facilitator ignores the attestation header. An Aethelred-aware receiver REQUIRES it — protecting the most-valuable receiving surfaces (regulated APIs, medical data, financial primitives) from anonymous or compromised-agent traffic.

## Usage — Client (agent side)

```typescript
import { x402Fetch, type TypedDataSigner, type AttestationProvider } from "@aethelred/wallet-x402";

const signer: TypedDataSigner = {
  address: "0x...",
  async signTypedData(req) {
    // Plug in your custody backend here:
    // - Local key via @aethelred/wallet-core
    // - Ledger HSM via @aethelred/wallet-ledger
    // - Fireblocks via @aethelred/wallet-custody-fireblocks
    // - AWS Nitro enclave self-signer
    return "0x...";
  },
};

const attestation: AttestationProvider = {
  async getQuote(userData) {
    // Call your TEE platform SDK:
    // - AWS Nitro: fetch attestation doc endpoint
    // - Intel TDX: DCAP quote_gen
    // - GCP Confidential Space: attestation service
    return teeQuote;
  },
};

const { response, receipt } = await x402Fetch("https://api.regulated-data.com/patient-record", {
  signer,
  attestation,
  onPolicyCheck: (req) => policyEngine.evaluate({ /* agent context */ }),
  audit: auditCapture,
});
```

## Usage — Facilitator (receiver side)

```typescript
import { verifyPayment, broadcastVerifiedPayment, encodeReceiptHeader } from "@aethelred/wallet-x402";

// Inside your Express/Fastify/Cloudflare-Worker middleware:
const verified = await verifyPayment({
  requirement: matchedRequirement,
  paymentHeader: req.headers["x-payment"],
  attestationHeader: req.headers["x-payment-attestation"],
  recover: (input) => ecRecover(input),  // your preferred recovery lib
  attestationVerifier: aethelredAttestationVerifier,
});

const receipt = await broadcastVerifiedPayment({
  verified,
  requirement: matchedRequirement,
  broadcaster: yourBroadcaster,
});

res.setHeader("X-PAYMENT-RESPONSE", encodeReceiptHeader(receipt));
res.json(paidResponseBody);
```

## Error taxonomy

Every thrown error is a typed `X402Error` subclass carrying a stable `code` string. Consumers should branch on `error.code`, never on `error.message`:

| Code | Thrown by | Meaning |
|---|---|---|
| `unsupported-scheme` | parser | 402 body advertised a scheme we don't implement |
| `unsupported-network` | parser / eip3009 | Network slug not in our registry |
| `no-acceptable-requirement` | parser | 402 body had empty `accepts[]` |
| `amount-over-cap` | client / eip3009 | Requested value > `maxAmountRequired` |
| `invalid-payment-requirement` | parser / eip3009 | Structural failure in 402 body |
| `signer-rejected` | eip3009 | The signer threw or returned malformed sig |
| `attestation-unavailable` | client | Receiver required attestation; client had no provider |
| `attestation-binding-failed` | attestation-binding | Hash or header malformed |
| `facilitator-rejected` | facilitator | Verification failed on the receiver side |
| `facilitator-network-error` | client | Transport failure on retry |
| `payment-receipt-invalid` | client | `X-PAYMENT-RESPONSE` header malformed |
| `attestation-verification-failed` | facilitator | Missing verifier configuration |
| `replay-detected` | facilitator | Nonce seen before |
| `receipt-binding-mismatch` | client | Facilitator's binding echo doesn't match |
| `unexpected-response-shape` | client | Server accepted but returned no receipt |

## Security properties

1. **Nonce unpredictability.** Authorizations use `crypto.getRandomValues` for the 32-byte nonce. Never derive from a counter.
2. **Bounded validity window.** `MAX_VALIDITY_WINDOW_SECONDS = 3600` — a stale authorization sitting in a mempool is replay-bait; we cap aggressively.
3. **Constant-time hash compare.** `verifyBindingHash` uses a byte-by-byte OR-xor compare.
4. **Policy before signing.** `x402Fetch` runs the policy hook BEFORE the signer is touched. A denied payment never exposes a signature to the network.
5. **Binding integrity.** Attestation and payment cannot be re-paired. Changing either changes the binding hash; the receiver recomputes and rejects the mismatch.

## Networks supported

| Network | Chain ID | USDC contract |
|---|---|---|
| Base Mainnet | 8453 | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |
| Base Sepolia | 84532 | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` |
| Polygon Mainnet | 137 | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` |
| Polygon Amoy | 80002 | `0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582` |
| Arbitrum Mainnet | 42161 | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` |
| Arbitrum Sepolia | 421614 | `0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d` |
| Optimism Mainnet | 10 | `0x0b2c639c533813f4aa9d7837caf62653d097ff85` |
| Optimism Sepolia | 11155420 | `0x5fd84259d66cd46123540766be93dfe6d43130d7` |
| Ethereum Mainnet | 1 | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` |
| Ethereum Sepolia | 11155111 | `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238` |

Adding a network is three lines: append to the `PaymentNetwork` union in `types.ts`, add the row to `chain-config.ts`, add a vector to the chain-config test. The TypeScript exhaustiveness checker catches incomplete adds at compile time.

## Test coverage

64 tests, including:
- Property-based canonical-JSON determinism over randomized struct hashes
- Full 402 → sign → retry → verify flow with stubbed fetch
- Every error-taxonomy code path pinned
- Round-trip header encode/decode
- Recovery-adapter integration (signer-address mismatch)
- Attestation binding verification (swapped quote, swapped payment, stripped echo, wrong binding)
