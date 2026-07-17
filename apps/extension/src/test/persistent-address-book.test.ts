import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeMessage } from "@aethelred/wallet-connect";
import { PersistentAddressBook } from "../popup/services/persistent-address-book";

const TREASURY = "0x1111111111111111111111111111111111111111";
const VENDOR = "0x2222222222222222222222222222222222222222";

interface RuntimeHarness {
  requests: BridgeMessage[];
  listeners: Set<(message: BridgeMessage) => void>;
  respondNext(result: unknown): void;
  rejectNext(message: string): void;
  broadcast(snapshot: unknown): void;
}

function installRuntime(): RuntimeHarness {
  const requests: BridgeMessage[] = [];
  const callbacks: Array<(response: BridgeMessage) => void> = [];
  const listeners = new Set<(message: BridgeMessage) => void>();
  const runtime = {
    id: "wallet-extension-id",
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((message: BridgeMessage, callback: (response: BridgeMessage) => void) => {
      requests.push(message);
      callbacks.push(callback);
    }),
    onMessage: {
      addListener: vi.fn((listener: (message: BridgeMessage) => void) => listeners.add(listener)),
      removeListener: vi.fn((listener: (message: BridgeMessage) => void) => listeners.delete(listener)),
    },
  };
  vi.stubGlobal("chrome", { runtime });

  return {
    requests,
    listeners,
    respondNext(result) {
      const request = requests[requests.length - callbacks.length];
      const callback = callbacks.shift();
      if (!callback || !request) throw new Error("No pending runtime request");
      callback({
        kind: "rpc-response",
        correlationId: request.correlationId,
        payload: { result },
        timestamp: Date.now(),
      });
    },
    rejectNext(message) {
      const request = requests[requests.length - callbacks.length];
      const callback = callbacks.shift();
      if (!callback || !request) throw new Error("No pending runtime request");
      callback({
        kind: "rpc-response",
        correlationId: request.correlationId,
        payload: { error: { code: -32602, message } },
        timestamp: Date.now(),
      });
    },
    broadcast(snapshot) {
      const message: BridgeMessage = {
        kind: "contacts-updated",
        correlationId: "",
        payload: snapshot,
        timestamp: Date.now(),
      };
      for (const listener of listeners) listener(message);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});
describe("PersistentAddressBook", () => {
  it("hydrates through contacts-list and never reports optimistic mutation success", async () => {
    const runtime = installRuntime();
    const addressBook = new PersistentAddressBook();
    const initialize = addressBook.initialize();
    expect(runtime.requests.at(-1)?.kind).toBe("contacts-list");
    runtime.respondNext({ contacts: [], revision: 0 });
    await initialize;

    const add = addressBook.addContact(TREASURY, "Treasury");
    expect(runtime.requests.at(-1)).toMatchObject({
      kind: "contacts-add",
      payload: { address: TREASURY, label: "Treasury" },
    });
    expect(addressBook.listContacts()).toEqual([]);

    runtime.respondNext({
      contacts: [{ address: TREASURY, label: "Treasury", addedAt: 10 }],
      revision: 1,
    });
    await expect(add).resolves.toEqual([
      { address: TREASURY, label: "Treasury", addedAt: 10 },
    ]);
    expect(addressBook.listContacts()).toHaveLength(1);

    const update = addressBook.updateContact(TREASURY, "Treasury Vault");
    expect(addressBook.listContacts()[0]?.label).toBe("Treasury");
    runtime.respondNext({
      contacts: [{ address: TREASURY, label: "Treasury Vault", addedAt: 10 }],
      revision: 2,
    });
    await update;
    expect(addressBook.listContacts()[0]?.label).toBe("Treasury Vault");

    const remove = addressBook.removeContact(TREASURY);
    expect(addressBook.listContacts()).toHaveLength(1);
    runtime.respondNext({ contacts: [], revision: 3 });
    await remove;
    expect(addressBook.listContacts()).toEqual([]);
  });

  it("keeps a newer broadcast when an older mutation response arrives late", async () => {
    const runtime = installRuntime();
    const addressBook = new PersistentAddressBook();
    const initialize = addressBook.initialize();
    runtime.respondNext({ contacts: [], revision: 0 });
    await initialize;

    const add = addressBook.addContact(TREASURY, "Treasury");
    runtime.broadcast({
      contacts: [{ address: VENDOR, label: "Vendor", addedAt: 20 }],
      revision: 2,
    });
    runtime.respondNext({
      contacts: [{ address: TREASURY, label: "Treasury", addedAt: 10 }],
      revision: 1,
    });
    await add;

    expect(addressBook.listContacts()).toEqual([
      { address: VENDOR, label: "Vendor", addedAt: 20 },
    ]);
  });

  it("leaves the cache unchanged when background validation rejects", async () => {
    const runtime = installRuntime();
    const addressBook = new PersistentAddressBook();
    const initialize = addressBook.initialize();
    runtime.respondNext({ contacts: [], revision: 0 });
    await initialize;

    const add = addressBook.addContact("random.jpg", "Image");
    runtime.rejectNext("Contact address must be a non-zero 20-byte EVM address");
    await expect(add).rejects.toThrow(/20-byte EVM address/);
    expect(addressBook.listContacts()).toEqual([]);
  });

  it("notifies subscribers for authoritative responses and broadcasts", async () => {
    const runtime = installRuntime();
    const addressBook = new PersistentAddressBook();
    const listener = vi.fn();
    addressBook.subscribe(listener);
    const initialize = addressBook.initialize();
    runtime.respondNext({ contacts: [], revision: 0 });
    await initialize;
    runtime.broadcast({
      contacts: [{ address: TREASURY, label: "Treasury", addedAt: 10 }],
      revision: 1,
    });
    expect(listener).toHaveBeenCalledTimes(2);

    addressBook.dispose();
    expect(runtime.listeners.size).toBe(0);
  });
});
