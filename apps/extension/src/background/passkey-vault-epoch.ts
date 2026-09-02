/** Minimal boundary implemented by MasterKey and convenient to race-test. */
export interface VaultEpochGuard {
  assertUnlockedAtEpoch(epoch: number): void;
}

/**
 * Commit a passkey credential/policy mutation only inside one unlocked vault
 * lifetime. If lock wins while the async commit is running, restore the prior
 * durable binding before propagating the stale-epoch error.
 */
export async function runVaultEpochBoundMutation<T>(options: {
  guard: VaultEpochGuard;
  epoch: number;
  mutate: () => Promise<T>;
  rollback: () => Promise<void>;
}): Promise<T> {
  options.guard.assertUnlockedAtEpoch(options.epoch);
  const result = await options.mutate();
  try {
    options.guard.assertUnlockedAtEpoch(options.epoch);
    return result;
  } catch (epochError) {
    try {
      await options.rollback();
    } catch (rollbackError) {
      const epochMessage = epochError instanceof Error
        ? epochError.message
        : String(epochError);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Passkey update crossed the vault lock boundary (${epochMessage}) and rollback failed (${rollbackMessage}); wallet remains fail-closed`,
        { cause: epochError },
      );
    }
    throw epochError;
  }
}
