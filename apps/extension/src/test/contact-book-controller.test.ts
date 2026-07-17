import { describe, expect, it } from "vitest";
import {
  StatePersistence,
  WALLET_STATE_STORAGE_KEY,
} from "@aethelred/wallet-chain";
import {
  ContactBookController,
  ContactBookValidationError,
  type ContactBookSnapshot,
} from "../background/contact-book";

class TestStorage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.writes.push(value);
    this.values.set(key, value);
  }
}

const TREASURY = "0x1111111111111111111111111111111111111111";
const VENDOR = "0x2222222222222222222222222222222222222222";
const RESERVE = "0x3333333333333333333333333333333333333333";

async function setup(now = 1_700_000_000_000) {
  const storage = new TestStorage();
  const persistence = new StatePersistence(storage);
  await persistence.load();
  const broadcasts: ContactBookSnapshot[] = [];
  const controller = new ContactBookController(
    persistence,
    (snapshot) => {
      broadcasts.push(structuredClone(snapshot));
    },
    () => now,
  );
  return { storage, persistence, broadcasts, controller };
}

describe("ContactBookController", () => {
  it("retains exact add/update/delete results across unrelated persistence and restart", async () => {
    const { storage, persistence, controller } = await setup();

    await controller.add({ address: TREASURY.toUpperCase().replace("0X", "0x"), label: " Treasury " });
    await controller.add({ address: VENDOR, label: "Vendor" });
    await controller.update({ address: TREASURY, label: "Treasury Vault" });
    await controller.delete({ address: VENDOR });

    // Represents any unrelated background persistState event occurring after
    // contact CRUD (network/account/audit changes all share this snapshot).
    persistence.update({ activeChainId: "0x1ca4", theme: "dark" });
    await persistence.saveNow();

    const restartedPersistence = new StatePersistence(storage);
    await restartedPersistence.load();
    const restarted = new ContactBookController(restartedPersistence);

    expect(restarted.snapshot()).toEqual({
      contacts: [
        {
          address: TREASURY,
          label: "Treasury Vault",
          addedAt: 1_700_000_000_000,
        },
      ],
      revision: 4,
    });
    expect(restartedPersistence.getState().activeChainId).toBe("0x1ca4");
    expect(restartedPersistence.getState().theme).toBe("dark");
  });

  it("serializes concurrent CRUD without dropping contacts", async () => {
    const { storage, controller, broadcasts } = await setup();

    await Promise.all([
      controller.add({ address: TREASURY, label: "Treasury" }),
      controller.add({ address: VENDOR, label: "Vendor" }),
    ]);
    await Promise.all([
      controller.update({ address: TREASURY, label: "Treasury Vault" }),
      controller.delete({ address: VENDOR }),
      controller.add({ address: RESERVE, label: "Reserve" }),
    ]);

    expect(controller.snapshot()).toEqual({
      contacts: [
        { address: TREASURY, label: "Treasury Vault", addedAt: 1_700_000_000_000 },
        { address: RESERVE, label: "Reserve", addedAt: 1_700_000_000_000 },
      ],
      revision: 5,
    });
    expect(broadcasts.map((snapshot) => snapshot.revision)).toEqual([1, 2, 3, 4, 5]);

    const persisted = JSON.parse(storage.values.get(WALLET_STATE_STORAGE_KEY) ?? "null") as {
      contacts: unknown[];
      contactsRevision: number;
    };
    expect(persisted.contacts).toEqual(controller.list());
    expect(persisted.contactsRevision).toBe(5);
  });

  it("rejects malformed, zero, duplicate, and unsafe contact input", async () => {
    const { controller } = await setup();

    await expect(controller.add({ address: "random.jpg", label: "Image" }))
      .rejects.toBeInstanceOf(ContactBookValidationError);
    await expect(controller.add({ address: `0x${"0".repeat(40)}`, label: "Zero" }))
      .rejects.toThrow(/non-zero/i);
    await expect(controller.add({ address: TREASURY, label: "Treasury" }))
      .resolves.toMatchObject({ revision: 1 });
    await expect(controller.add({ address: TREASURY.toUpperCase().replace("0X", "0x"), label: "Again" }))
      .rejects.toThrow(/already exists/i);
    await expect(controller.update({ address: TREASURY, label: "unsafe\u202Ename" }))
      .rejects.toThrow(/unsafe/i);
    await expect(controller.delete({ address: VENDOR })).rejects.toThrow(/not found/i);
  });
});

describe("StatePersistence ordered writes", () => {
  it("cannot let an older whole-state write land after a newer contact save", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writeCount = 0;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const values = new Map<string, string>();
    const storage = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        writeCount += 1;
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        if (writeCount === 1) await firstBlocked;
        values.set(key, value);
        activeWrites -= 1;
      },
    };
    const persistence = new StatePersistence(storage);
    await persistence.load();

    persistence.update({ theme: "dark" });
    const olderSave = persistence.saveNow();
    await Promise.resolve();
    persistence.update({
      contacts: [{ address: TREASURY, label: "Treasury", addedAt: 1 }],
      contactsRevision: 1,
    });
    const newerSave = persistence.saveNow();
    releaseFirst();
    await Promise.all([olderSave, newerSave]);

    const restarted = new StatePersistence(storage);
    await restarted.load();
    expect(maxActiveWrites).toBe(1);
    expect(restarted.getState().theme).toBe("dark");
    expect(restarted.getState().contacts).toEqual([
      { address: TREASURY, label: "Treasury", addedAt: 1 },
    ]);
    expect(restarted.getState().contactsRevision).toBe(1);
  });
});
