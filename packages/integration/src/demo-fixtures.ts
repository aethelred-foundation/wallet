/**
 * In-memory fixtures that let the end-to-end demo exercise every
 * package without a real chain or enclave. These are NOT production
 * implementations — they're simulation substrates that behave
 * byte-identically to the real interfaces so the demo's control
 * flow exactly mirrors what runs against mainnet + a real Nitro.
 */

import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex as nobleBytesToHex } from "@noble/hashes/utils.js";

// Wire secp256k1 HMAC once per process (test suite shares this).
import * as secp from "@noble/secp256k1";
if (!secp.etc.hmacSha256Sync) {
  secp.etc.hmacSha256Sync = (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}

import type {
  EnclaveSignatureRequest,
  EnclaveSignatureResponse,
  EnclaveTransport,
  EnclavePublicKeyResponse,
  TeeAttestationBundle,
} from "@aethelred/wallet-custody-adapters";
import type {
  AnchorChainProvider,
  RawLog,
  TxReceipt,
} from "@aethelred/wallet-notarization";
import type {
  BudgetClient,
  CanSpendResult,
} from "@aethelred/wallet-agent-budget";
import type {
  FireblocksClient,
  FireblocksCreateResponse,
  FireblocksStatusResponse,
} from "@aethelred/wallet-custody-adapters";

// ─── Simulated Nitro enclave ────────────────────────────

/**
 * In-process simulation of a Nitro enclave. Holds a real private
 * key; produces real secp256k1 signatures + mock attestation
 * bundles. Useful for demo + test; production swaps in a transport
 * that talks vsock / HTTPS-mTLS to a real sealed enclave.
 */
export class SimulatedEnclave implements EnclaveTransport {
  readonly privateKey: Uint8Array;
  readonly publicKeyUncompressed: Uint8Array;
  readonly address: `0x${string}`;

  constructor(privateKeyHex?: `0x${string}`) {
    if (privateKeyHex) {
      this.privateKey = hexToBytes(privateKeyHex);
    } else {
      const pk = new Uint8Array(32);
      crypto.getRandomValues(pk);
      while (!secp256k1.utils.isValidPrivateKey(pk)) crypto.getRandomValues(pk);
      this.privateKey = pk;
    }
    this.publicKeyUncompressed = secp256k1.getPublicKey(this.privateKey, false);
    const hash = keccak_256(this.publicKeyUncompressed.slice(1));
    this.address = ("0x" + nobleBytesToHex(hash.slice(-20))) as `0x${string}`;
  }

  async requestPublicKey(): Promise<EnclavePublicKeyResponse> {
    return {
      address: this.address,
      uncompressedPublicKey: ("0x" + nobleBytesToHex(this.publicKeyUncompressed)) as `0x${string}`,
      attestation: this.fakeAttestation(("0x" + "00".repeat(32)) as `0x${string}`),
    };
  }

  async requestSignature(req: EnclaveSignatureRequest): Promise<EnclaveSignatureResponse> {
    const sig = secp256k1.sign(req.digest, this.privateKey, { lowS: true });
    const rs = sig.toCompactRawBytes();
    const out = new Uint8Array(65);
    out.set(rs, 0);
    out[64] = 27 + (sig.recovery ?? 0);
    const signature = ("0x" + nobleBytesToHex(out)) as `0x${string}`;
    return {
      signature,
      attestation: req.userData ? this.fakeAttestation(req.userData) : undefined,
    };
  }

  async requestAttestation(userData: `0x${string}`): Promise<TeeAttestationBundle> {
    return this.fakeAttestation(userData);
  }

  private fakeAttestation(nonce: `0x${string}`): TeeAttestationBundle {
    return {
      platform: "aws-nitro",
      version: "1.0",
      quote: ("0x" + "de".repeat(128)) as `0x${string}`,
      measurements: {
        codeHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
        configHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
        platformSecurityVersion: "1.2.3",
      },
      generatedAt: Date.now(),
      nonce,
    };
  }
}

// ─── Simulated Notary chain provider ────────────────────

/**
 * In-memory anchor chain — simulates the Notary contract + the RPC
 * provider the OnChainAnchorAdapter talks to. `anchor(root, count)`
 * calls produce a receipt + a BatchAnchored log the adapter parses.
 */
export class SimulatedAnchorChain implements AnchorChainProvider {
  readonly chainId: number;
  private nextBatchId = 0n;
  private blockNumber = 1000n;
  private nextTxIdx = 0;
  private readonly receipts = new Map<string, TxReceipt>();
  private readonly submitter: `0x${string}`;
  private readonly contract: `0x${string}`;

  constructor(opts: {
    readonly chainId: number;
    readonly submitter: `0x${string}`;
    readonly contract: `0x${string}`;
  }) {
    this.chainId = opts.chainId;
    this.submitter = opts.submitter;
    this.contract = opts.contract;
  }

  async sendTransaction(request: { readonly to: `0x${string}`; readonly data: `0x${string}` }): Promise<`0x${string}`> {
    const txHash = ("0x" + "ab".repeat(30) + this.nextTxIdx.toString(16).padStart(4, "0")) as `0x${string}`;
    this.nextTxIdx += 1;
    // Decode `anchor(bytes32 root, uint32 count)` — selector + root + count
    const payload = request.data.slice(10); // strip 0x + 4-byte selector
    const root = ("0x" + payload.slice(0, 64)) as `0x${string}`;
    const count = Number(BigInt("0x" + payload.slice(64, 128)));
    const batchId = this.nextBatchId++;
    const log: RawLog = {
      address: request.to,
      topics: [
        TOPIC_BATCH_ANCHORED,
        ("0x" + batchId.toString(16).padStart(64, "0")) as `0x${string}`,
        ("0x" + "00".repeat(12) + this.submitter.slice(2)) as `0x${string}`,
        root,
      ],
      data: encodeBatchAnchoredData(BigInt(Math.floor(Date.now() / 1000)), count),
      blockNumber: this.blockNumber,
      transactionHash: txHash,
      logIndex: 0,
    };
    this.receipts.set(txHash.toLowerCase(), {
      transactionHash: txHash,
      blockNumber: this.blockNumber,
      status: "success",
      logs: [log],
    });
    this.blockNumber += 1n;
    void this.contract;
    return txHash;
  }

  async getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null> {
    return this.receipts.get(txHash.toLowerCase()) ?? null;
  }
}

/**
 * Pre-computed `keccak256("BatchAnchored(uint256,address,bytes32,uint64,uint32)")`
 * — matches the constant the notarization package derives at load
 * time. Duplicated here (tolerating a tiny bit of redundancy) so the
 * demo fixture doesn't have to import the internal constant.
 */
const TOPIC_BATCH_ANCHORED = ("0x" +
  nobleBytesToHex(
    keccak_256(new TextEncoder().encode(
      "BatchAnchored(uint256,address,bytes32,uint64,uint32)",
    )),
  )) as `0x${string}`;

function encodeBatchAnchoredData(timestamp: bigint, eventCount: number): `0x${string}` {
  const ts = timestamp.toString(16).padStart(64, "0");
  const ec = eventCount.toString(16).padStart(64, "0");
  return ("0x" + ts + ec) as `0x${string}`;
}

// ─── Simulated AgentBudget client ───────────────────────

/**
 * An in-memory stand-in for the on-chain AgentBudget. Implements
 * the `canSpend` method the gates consume; ignores prepare* write
 * calls (the demo doesn't submit them). Real deployments instantiate
 * `BudgetClient` against a chain provider; this simulates the same
 * contract shape for the flow.
 */
export class SimulatedBudgetClient implements Pick<BudgetClient, "canSpend"> {
  private readonly sessions = new Map<
    string,
    { perCallCap: bigint; dailyCap: bigint; spent: bigint; revoked: boolean }
  >();

  grant(sessionKey: `0x${string}`, caps: { perCallCap: bigint; dailyCap: bigint }): void {
    this.sessions.set(sessionKey.toLowerCase(), {
      perCallCap: caps.perCallCap,
      dailyCap: caps.dailyCap,
      spent: 0n,
      revoked: false,
    });
  }

  revoke(sessionKey: `0x${string}`): void {
    const s = this.sessions.get(sessionKey.toLowerCase());
    if (s) s.revoked = true;
  }

  recordSpend(sessionKey: `0x${string}`, amount: bigint): void {
    const s = this.sessions.get(sessionKey.toLowerCase());
    if (!s) return;
    s.spent += amount;
  }

  async canSpend(sessionKey: `0x${string}`, amount: bigint): Promise<CanSpendResult> {
    const s = this.sessions.get(sessionKey.toLowerCase());
    if (!s) return { ok: false, reasonByte: 1, reason: "session-not-found" };
    if (s.revoked) return { ok: false, reasonByte: 2, reason: "session-revoked" };
    if (amount <= 0n) return { ok: false, reasonByte: 8, reason: "zero-amount" };
    if (amount > s.perCallCap)
      return { ok: false, reasonByte: 5, reason: "per-call-cap-exceeded" };
    if (s.spent + amount > s.dailyCap)
      return { ok: false, reasonByte: 7, reason: "daily-cap-exceeded" };
    return { ok: true, reasonByte: 0, reason: "ok" };
  }
}

// ─── Simulated Fireblocks (if the demo swaps custody) ──

/**
 * Minimal Fireblocks client stub — demo doesn't use it, but we
 * export it so callers running the demo with Fireblocks custody
 * don't need to implement one themselves.
 */
export class SimulatedFireblocksClient implements FireblocksClient {
  private nextId = 0;
  private readonly privateKey: Uint8Array;

  constructor(privateKeyHex: `0x${string}`) {
    this.privateKey = hexToBytes(privateKeyHex);
  }

  async createTransaction(): Promise<FireblocksCreateResponse> {
    return { id: `tx-${this.nextId++}`, status: "SUBMITTED" };
  }

  async getTransaction(id: string): Promise<FireblocksStatusResponse> {
    // Fake signature — not used in the primary demo path.
    const digest = keccak_256(new TextEncoder().encode(id));
    const sig = secp256k1.sign(digest, this.privateKey, { lowS: true });
    const rs = sig.toCompactRawBytes();
    return {
      id,
      status: "COMPLETED",
      signedMessages: [
        {
          content: ("0x" + nobleBytesToHex(digest)) as `0x${string}`,
          signature: {
            fullSig: ("0x" + nobleBytesToHex(rs)) as `0x${string}`,
            v: sig.recovery ?? 0,
          },
        },
      ],
    };
  }
}

// ─── Helpers ────────────────────────────────────────────

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
