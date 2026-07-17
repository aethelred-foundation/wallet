import type { TrackedPendingTransaction } from "@aethelred/wallet-chain";
import type { PendingTxSummary } from "@aethelred/wallet-connect";

/**
 * Project the durable pending-transaction record onto the popup bridge shape.
 * The tracker deliberately stores bigint fee/value fields; Chrome extension
 * messages must receive strings so they can cross the JSON-based boundary.
 */
export function toPendingTxSummary(
  tracked: TrackedPendingTransaction,
): PendingTxSummary {
  const { original, gasSuggestion } = tracked;
  return {
    txHash: tracked.txHash,
    nonce: tracked.nonce,
    fromAddress: tracked.fromAddress,
    chainId: tracked.chainId,
    submittedAt: tracked.submittedAt,
    to: original.to,
    value: original.value.toString(),
    data: original.data,
    type: original.type,
    maxFeePerGas: original.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: original.maxPriorityFeePerGas?.toString(),
    gasPrice: original.gasPrice?.toString(),
    gasLimit: original.gasLimit.toString(),
    replacedBy: tracked.replacedBy,
    replacementKind: tracked.replacementKind,
    suggestion: gasSuggestion
      ? {
          minBumpPercent: gasSuggestion.minBumpPercent,
          speedUp: {
            maxFeePerGas: gasSuggestion.speedUp.maxFeePerGas.toString(),
            maxPriorityFeePerGas:
              gasSuggestion.speedUp.maxPriorityFeePerGas.toString(),
            gasPrice: gasSuggestion.speedUp.gasPrice?.toString(),
          },
          cancel: {
            maxFeePerGas: gasSuggestion.cancel.maxFeePerGas.toString(),
            maxPriorityFeePerGas:
              gasSuggestion.cancel.maxPriorityFeePerGas.toString(),
            gasPrice: gasSuggestion.cancel.gasPrice?.toString(),
          },
        }
      : undefined,
  };
}
