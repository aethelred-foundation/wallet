import type { BridgeMessage } from "@aethelred/wallet-connect";

export interface SavedContact {
  address: string;
  label: string;
  addedAt: number;
}

interface ContactBookSnapshot {
  contacts: SavedContact[];
  revision: number;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function hasExtensionRuntime(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    Boolean(chrome.runtime.id)
  );
}

function parseSnapshot(value: unknown): ContactBookSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Background returned an invalid saved-recipient snapshot");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.contacts) ||
    typeof candidate.revision !== "number" ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0
  ) {
    throw new Error("Background returned an invalid saved-recipient snapshot");
  }

  const contacts = candidate.contacts.map((value): SavedContact => {
    if (!value || typeof value !== "object") {
      throw new Error("Background returned an invalid saved recipient");
    }
    const contact = value as Record<string, unknown>;
    if (
      typeof contact.address !== "string" ||
      !EVM_ADDRESS.test(contact.address) ||
      typeof contact.label !== "string" ||
      contact.label.length === 0 ||
      typeof contact.addedAt !== "number" ||
      !Number.isSafeInteger(contact.addedAt) ||
      contact.addedAt <= 0
    ) {
      throw new Error("Background returned an invalid saved recipient");
    }
    return {
      address: contact.address.toLowerCase(),
      label: contact.label,
      addedAt: contact.addedAt,
    };
  });

  return { contacts, revision: candidate.revision };
}

/**
 * Popup-side projection of the background-owned contact book.
 *
 * Mutations are intentionally asynchronous and only update the local cache
 * after the background has durably committed and returned its authoritative
 * snapshot. A monotonic revision prevents a delayed response from replacing a
 * newer contacts-updated broadcast.
 */
export class PersistentAddressBook {
  private contacts: readonly SavedContact[] = [];
  private revision = -1;
  private readonly listeners = new Set<() => void>();
  private listening = false;

  private readonly onRuntimeMessage = (message: BridgeMessage): void => {
    if (message.kind !== "contacts-updated") return;
    this.applySnapshot(parseSnapshot(message.payload));
  };

  async initialize(): Promise<void> {
    this.requireRuntime();
    this.startListening();
    const snapshot = await this.send("contacts-list", {});
    this.applySnapshot(snapshot);
  }

  dispose(): void {
    if (!this.listening || !hasExtensionRuntime()) return;
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    this.listening = false;
  }

  listContacts(): SavedContact[] {
    return this.contacts.map((contact) => ({ ...contact }));
  }

  getSnapshot = (): readonly SavedContact[] => this.contacts;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async addContact(address: string, label: string): Promise<SavedContact[]> {
    return this.mutate("contacts-add", { address, label });
  }

  async updateContact(address: string, label: string): Promise<SavedContact[]> {
    return this.mutate("contacts-update", { address, label });
  }

  async removeContact(address: string): Promise<SavedContact[]> {
    return this.mutate("contacts-delete", { address });
  }

  private async mutate(
    kind: "contacts-add" | "contacts-update" | "contacts-delete",
    payload: Record<string, string>,
  ): Promise<SavedContact[]> {
    this.requireRuntime();
    const snapshot = await this.send(kind, payload);
    this.applySnapshot(snapshot);
    return this.listContacts();
  }

  private async send(
    kind: "contacts-list" | "contacts-add" | "contacts-update" | "contacts-delete",
    payload: unknown,
  ): Promise<ContactBookSnapshot> {
    return new Promise<ContactBookSnapshot>((resolve, reject) => {
      const message: BridgeMessage = {
        kind,
        correlationId: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        payload,
        timestamp: Date.now(),
      };
      chrome.runtime.sendMessage(message, (response: BridgeMessage) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        const responsePayload = response?.payload as {
          result?: unknown;
          error?: { message?: unknown };
        } | undefined;
        if (responsePayload?.error) {
          reject(new Error(
            typeof responsePayload.error.message === "string"
              ? responsePayload.error.message
              : "Saved-recipient operation failed",
          ));
          return;
        }
        try {
          resolve(parseSnapshot(responsePayload?.result));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private applySnapshot(snapshot: ContactBookSnapshot): void {
    if (snapshot.revision < this.revision) return;
    this.revision = snapshot.revision;
    this.contacts = snapshot.contacts.map((contact) => ({ ...contact }));
    for (const listener of this.listeners) listener();
  }

  private startListening(): void {
    if (this.listening) return;
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    this.listening = true;
  }

  private requireRuntime(): void {
    if (!hasExtensionRuntime()) {
      throw new Error("Saved recipients require the packaged wallet background");
    }
  }
}

export function canUseSavedRecipientBackground(): boolean {
  return hasExtensionRuntime();
}
