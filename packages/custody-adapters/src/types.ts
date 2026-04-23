/**
 * `@aethelred/wallet-custody-adapters` — type surface.
 *
 * A **custody adapter** is the unit of pluggable signing. The same
 * x402 client, MCP server, and intent router can be configured
 * with any adapter that implements this contract:
 *
 *     import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
 *     const adapter = new LocalKeyAdapter({ privateKey: ... });
 *     await x402Fetch(url, { signer: adapter.asTypedDataSigner() });
 *
 * Adapters fall into four tiers based on where the private key
 * material lives:
 *
 *   1. **Local (software key in memory)** — development, reference
 *      implementations, and the baseline for all tests. NOT for
 *      production agent wallets handling real money.
 *
 *   2. **Shared-custody (Shamir 2-of-2)** — key split between client
 *      and a trusted coordinator (typically the wallet's backend
 *      service or an MPC cohort). Neither party can sign alone.
 *      This is the MoltPe-parity tier for customers who want
 *      self-custody but don't have a hardware option.
 *
 *   3. **Hardware-rooted (Ledger HSM)** — private key never leaves
 *      the device; every signing operation requires physical user
 *      approval. Suitable for high-value signing agents or
 *      human-operator sessions.
 *
 *   4. **TEE-rooted (AWS Nitro Enclave, Intel TDX, GCP Confidential
 *      Space)** — key material lives inside the attested execution
 *      environment and is sealed to a specific code measurement.
 *      This is the **moat tier** for x402: every signed payment
 *      can carry a fresh TEE quote that proves the code integrity
 *      of the signer, and the quote binds to the exact payment
 *      struct hash. MoltPe cannot replicate this without
 *      architecting their entire custody stack around TEEs.
 *
 * The `CustodyAdapter` contract exposes three orthogonal things
 * callers need:
 *
 *   - `address` — the Ethereum address associated with this adapter.
 *   - `capabilities` — what the adapter can do (sign EIP-712, sign
 *     raw transactions, produce TEE quotes, etc.).
 *   - `signTypedData` / `signRawTransaction` — the actual signing
 *     entry points.
 *
 * We deliberately separate `signTypedData` from `signRawTransaction`
 * (rather than one generic `sign(bytes)` method) because:
 *
 *   - Hardware wallets interpret the two differently — Ledger has
 *     dedicated screens for EIP-712 vs. raw tx, and showing a raw
 *     32-byte hash when the user is actually signing a structured
 *     payment is a usability + security anti-pattern.
 *   - TEE enclaves can implement domain-specific policy (e.g.
 *     "only sign EIP-712 TransferWithAuthorization, reject raw tx").
 *   - Audit trails distinguish the two cleanly.
 *
 * @packageDocumentation
 */

import type { TypedDataSigner, TypedDataDomain, TypedDataField } from "@aethelred/wallet-x402";

export type { TypedDataSigner, TypedDataDomain, TypedDataField };

/**
 * Adapter capabilities — static facts about what this backend can
 * do. The x402 client and MCP server branch on these at construction
 * time to wire up fall-through behaviors (e.g. if
 * `canProduceAttestation === false`, don't try to call an
 * attestation-gated x402 resource).
 */
export interface CustodyCapabilities {
  /** Adapter can produce EIP-712 typed-data signatures. */
  readonly canSignTypedData: boolean;

  /** Adapter can sign raw EVM transactions (EIP-1559 + legacy). */
  readonly canSignRawTransaction: boolean;

  /** Adapter can export the public key / address. */
  readonly canExportPublicKey: boolean;

  /**
   * Adapter runs inside a TEE and can produce a fresh attestation
   * quote that binds to user-supplied data. Required for the
   * x402 TEE-attestation moat path.
   */
  readonly canProduceAttestation: boolean;

  /**
   * Adapter requires user interaction on every signing operation
   * (e.g. a Ledger screen confirmation). Callers use this to
   * surface "waiting for hardware" UI states and to decide whether
   * batching is possible.
   */
  readonly requiresUserInteraction: boolean;

  /**
   * Adapter requires network access to sign (e.g. Fireblocks REST,
   * Nitro enclave remote-signing). Offline environments may filter
   * these out.
   */
  readonly requiresNetworkAccess: boolean;

  /**
   * Human-readable label for this adapter, e.g. "local-key",
   * "ledger-ethereum", "nitro-enclave-us-east-1", "shamir-2of2-web".
   * Surfaces in audit events and UI.
   */
  readonly label: string;
}

/**
 * Raw EVM transaction payload to sign. Subset of what
 * `@aethelred/wallet-core`'s TxRequest supports — the adapters only
 * need the fields that uniquely identify the transaction and cover
 * the signing preimage.
 */
export interface RawTransactionRequest {
  readonly chainId: number;
  readonly type: "eip1559" | "legacy";
  readonly to: `0x${string}`;
  readonly value: string; // decimal wei string
  readonly data: `0x${string}`;
  readonly gasLimit: string;
  readonly nonce: number;
  // EIP-1559
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  // Legacy
  readonly gasPrice?: string;
}

/**
 * Request to sign a typed-data payload. Same shape as x402's
 * `TypedDataSigner.signTypedData` arg; redeclared here so adapters
 * don't have to transitively import from `@aethelred/wallet-x402`
 * to answer the signing contract.
 */
export interface TypedDataRequest {
  readonly domain: TypedDataDomain;
  readonly types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

/**
 * The universal custody adapter contract. Every backend implements
 * this and exposes itself as a `TypedDataSigner` via `asTypedDataSigner`.
 */
export interface CustodyAdapter {
  /** Ethereum address this adapter signs for. */
  readonly address: `0x${string}`;

  /** Static capability descriptor. */
  readonly capabilities: CustodyCapabilities;

  /** Sign an EIP-712 typed-data payload. */
  signTypedData(req: TypedDataRequest): Promise<`0x${string}`>;

  /**
   * Sign a raw EVM transaction. Optional — adapters may reject
   * with `capability-not-supported` if `canSignRawTransaction` is
   * false. The separate method (vs. generic `sign(hash)`) lets
   * hardware wallets render transaction-specific screens.
   */
  signRawTransaction?(req: RawTransactionRequest): Promise<`0x${string}`>;

  /**
   * Produce a TEE attestation quote that binds to `userData`. Only
   * available when `canProduceAttestation === true`. This is the
   * entry point the x402 `AttestationProvider` uses to fetch a
   * fresh quote before each payment.
   */
  produceAttestation?(userData: `0x${string}`): Promise<TeeAttestationBundle>;

  /**
   * Adapter-specific teardown (close hardware transport, release
   * network sockets, zeroize in-memory key material, etc.). Callers
   * invoke this on shutdown paths.
   */
  dispose?(): Promise<void>;

  /**
   * Narrow the adapter to the x402 `TypedDataSigner` shape. Handy
   * one-liner for call sites that don't care about the full adapter
   * surface — just want to pass something to `x402Fetch`.
   */
  asTypedDataSigner(): TypedDataSigner;
}

/**
 * Attestation bundle returned by `produceAttestation`. Shape mirrors
 * `@aethelred/wallet-compliance/TeeQuote` so the x402
 * `AttestationProvider` can return it directly.
 *
 * We redeclare a minimal shape here so this package doesn't take a
 * hard dep on `@aethelred/wallet-compliance`; concrete TEE adapters
 * import the real type and narrow it into this interface.
 */
export interface TeeAttestationBundle {
  readonly platform: "intel-tdx" | "amd-sev-snp" | "aws-nitro" | "gcp-confidential-space" | "azure-attestation";
  readonly version: string;
  readonly quote: `0x${string}`;
  readonly measurements: {
    readonly codeHash: `0x${string}`;
    readonly configHash: `0x${string}`;
    readonly platformSecurityVersion: string;
    readonly extraClaims?: Readonly<Record<string, string>>;
  };
  readonly generatedAt: number;
  /**
   * The user-data field the TEE binds into the quote. MUST match
   * what the caller passed to `produceAttestation`. Callers
   * verify this to detect adapter-swap attacks (adapter returns
   * a cached quote with stale user-data).
   */
  readonly nonce: `0x${string}`;
}
