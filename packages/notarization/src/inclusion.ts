/**
 * Anchored inclusion proofs — bind a Merkle proof to an on-chain
 * batch record so verifiers can check both in one go.
 *
 * A regulator (or any third-party auditor) receives:
 *
 *   - An `AnchoredProof` containing the `MerkleProof` AND the
 *     `OnChainBatchRecord` (batchId, root, blockNumber, txHash).
 *   - The Notary contract address + chain id (public knowledge).
 *
 * They verify by:
 *
 *   1. `verifyMerkleProof(proof)` — cryptographic proof that the
 *      claimed leaf hash is part of `record.merkleRoot`.
 *
 *   2. Optional (requires RPC): fetch `batches(batchId)` from the
 *      Notary contract, check its `merkleRoot` matches
 *      `record.merkleRoot`, confirm `timestamp` matches
 *      `record.timestamp`. This step proves the record wasn't
 *      fabricated by the operator.
 *
 * The package offers `verifyAnchoredProof()` for step 1 — the
 * purely-off-line check. Step 2 is caller's job because it
 * requires an RPC dep we deliberately don't take.
 */

import { verifyMerkleProof, type MerkleProof } from "@aethelred/wallet-audit";

import { NotarizationError } from "./errors";
import type { AnchoredProof, OnChainBatchRecord } from "./types";

export interface BuildAnchoredProofArgs {
  readonly proof: MerkleProof;
  readonly record: OnChainBatchRecord;
  readonly eventId: string;
  readonly subjectId?: string;
}

/**
 * Build an `AnchoredProof` from its parts. Enforces consistency:
 * `proof.root` must match `record.merkleRoot` (sans `0x` +
 * lower-cased). Throws `proof-root-mismatch` otherwise.
 */
export function buildAnchoredProof(args: BuildAnchoredProofArgs): AnchoredProof {
  const proofRoot = stripHex(args.proof.root).toLowerCase();
  const recordRoot = stripHex(args.record.merkleRoot).toLowerCase();
  if (proofRoot !== recordRoot) {
    throw new NotarizationError(
      "proof-root-mismatch",
      `MerkleProof.root ${args.proof.root} does not match record.merkleRoot ${args.record.merkleRoot}`,
      { details: { proofRoot, recordRoot } },
    );
  }
  return {
    proof: args.proof,
    record: args.record,
    eventId: args.eventId,
    subjectId: args.subjectId,
  };
}

/**
 * Verify the Merkle-cryptographic side of an `AnchoredProof`. The
 * caller separately confirms the `record` matches the on-chain
 * state (requires an RPC call + contract ABI — we don't embed one).
 *
 * Throws `NotarizationError` on failure so callers can branch on
 * `code`. Returns `void` on success.
 */
export function verifyAnchoredProof(bundle: AnchoredProof): void {
  const proofRoot = stripHex(bundle.proof.root).toLowerCase();
  const recordRoot = stripHex(bundle.record.merkleRoot).toLowerCase();
  if (proofRoot !== recordRoot) {
    throw new NotarizationError(
      "proof-root-mismatch",
      `bundle.proof.root does not match bundle.record.merkleRoot`,
    );
  }
  const ok = verifyMerkleProof(bundle.proof);
  if (!ok) {
    throw new NotarizationError(
      "proof-merkle-invalid",
      `Merkle proof for event ${bundle.eventId} does not verify against root ${bundle.proof.root}`,
      {
        details: {
          eventId: bundle.eventId,
          batchId: bundle.record.batchId.toString(),
          root: bundle.proof.root,
        },
      },
    );
  }
}

/**
 * Cross-check an `OnChainBatchRecord` against a fresh fetch from
 * the chain. Caller supplies the record re-fetched via their own
 * `eth_getLogs` / `getBatch(batchId)` call; we return a boolean +
 * the mismatched field list.
 *
 * Useful for auditors who want to confirm the record wasn't
 * fabricated. We keep this logic here (rather than making the
 * caller write it) so every verification tool follows the same
 * rule set.
 */
export function compareRecords(
  declared: OnChainBatchRecord,
  onChain: OnChainBatchRecord,
): { readonly matches: boolean; readonly mismatches: ReadonlyArray<string> } {
  const mismatches: string[] = [];
  if (declared.batchId !== onChain.batchId) mismatches.push("batchId");
  if (declared.chainId !== onChain.chainId) mismatches.push("chainId");
  if (declared.contract.toLowerCase() !== onChain.contract.toLowerCase())
    mismatches.push("contract");
  if (
    declared.merkleRoot.toLowerCase() !== onChain.merkleRoot.toLowerCase()
  )
    mismatches.push("merkleRoot");
  if (declared.submitter.toLowerCase() !== onChain.submitter.toLowerCase())
    mismatches.push("submitter");
  if (declared.eventCount !== onChain.eventCount) mismatches.push("eventCount");
  if (declared.timestamp !== onChain.timestamp) mismatches.push("timestamp");
  if (declared.blockNumber !== onChain.blockNumber) mismatches.push("blockNumber");
  if (
    declared.transactionHash.toLowerCase() !== onChain.transactionHash.toLowerCase()
  )
    mismatches.push("transactionHash");
  return { matches: mismatches.length === 0, mismatches };
}

// ─── Helpers ──────────────────────────────────────────────

function stripHex(v: string): string {
  return v.startsWith("0x") ? v.slice(2) : v;
}
