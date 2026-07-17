import { describe, expect, it } from "vitest";
import { LockedError } from "@aethelred/wallet-core";
import { runVaultEpochBoundMutation } from "../background/passkey-vault-epoch";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("passkey vault-epoch mutation boundary", () => {
  it("rolls back a durable binding mutation completed after auto-lock", async () => {
    let epoch = 7;
    let unlocked = true;
    let durableCredential = "old-credential";
    let durablePolicy = "required";
    const mutationStarted = deferred();
    const releaseMutation = deferred();

    const pending = runVaultEpochBoundMutation({
      guard: {
        assertUnlockedAtEpoch(expected) {
          if (!unlocked || expected !== epoch) throw new LockedError();
        },
      },
      epoch,
      mutate: async () => {
        mutationStarted.resolve();
        await releaseMutation.promise;
        durableCredential = "new-credential";
        durablePolicy = "none";
        return true;
      },
      rollback: async () => {
        durableCredential = "old-credential";
        durablePolicy = "required";
      },
    });

    await mutationStarted.promise;
    unlocked = false;
    epoch += 1;
    releaseMutation.resolve();

    await expect(pending).rejects.toBeInstanceOf(LockedError);
    expect({ durableCredential, durablePolicy }).toEqual({
      durableCredential: "old-credential",
      durablePolicy: "required",
    });
  });
});
