import type { StatePersistence } from "@aethelred/wallet-chain";

export interface SavedContact {
  address: string;
  label: string;
  addedAt: number;
}

export interface ContactBookSnapshot {
  contacts: SavedContact[];
  revision: number;
}

export class ContactBookValidationError extends Error {
  readonly code = -32602;

  constructor(message: string) {
    super(message);
    this.name = "ContactBookValidationError";
  }
}

type ContactPersistence = Pick<StatePersistence, "getState" | "update" | "saveNow">;
type ContactBroadcast = (snapshot: ContactBookSnapshot) => void | Promise<void>;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const UNSAFE_LABEL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
const MAX_CONTACT_LABEL_LENGTH = 80;

function cloneContacts(contacts: readonly SavedContact[]): SavedContact[] {
  return contacts.map((contact) => ({ ...contact }));
}

function parseAddress(value: unknown): string {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value) || ZERO_ADDRESS.test(value)) {
    throw new ContactBookValidationError("Contact address must be a non-zero 20-byte EVM address");
  }
  return value.toLowerCase();
}

function parseLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new ContactBookValidationError("Contact label must be a string");
  }
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_CONTACT_LABEL_LENGTH) {
    throw new ContactBookValidationError(
      `Contact label must contain between 1 and ${MAX_CONTACT_LABEL_LENGTH} characters`,
    );
  }
  if (UNSAFE_LABEL_CHARACTERS.test(label)) {
    throw new ContactBookValidationError("Contact label contains unsafe control characters");
  }
  return label;
}

function parseStoredContact(value: unknown): SavedContact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  try {
    const address = parseAddress(candidate.address);
    const label = parseLabel(candidate.label);
    if (
      typeof candidate.addedAt !== "number" ||
      !Number.isSafeInteger(candidate.addedAt) ||
      candidate.addedAt <= 0
    ) {
      return null;
    }
    return { address, label, addedAt: candidate.addedAt };
  } catch {
    return null;
  }
}

/**
 * Background-owned contact store.
 *
 * The popup never reads or writes the whole wallet-state storage object. All
 * mutations are serialized here, merged into the live StatePersistence
 * snapshot, durably saved, and only then returned/broadcast as authoritative.
 */
export class ContactBookController {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: ContactPersistence,
    private readonly broadcast: ContactBroadcast = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  list(): SavedContact[] {
    const raw = this.persistence.getState().contacts;
    const contacts: SavedContact[] = [];
    const seen = new Set<string>();
    for (const value of raw) {
      const contact = parseStoredContact(value);
      if (!contact || seen.has(contact.address)) continue;
      seen.add(contact.address);
      contacts.push(contact);
    }
    return cloneContacts(contacts);
  }

  snapshot(): ContactBookSnapshot {
    const revision = this.persistence.getState().contactsRevision;
    return {
      contacts: this.list(),
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    };
  }

  add(payload: unknown): Promise<ContactBookSnapshot> {
    return this.mutate(() => {
      const input = this.requireObject(payload);
      const address = parseAddress(input.address);
      const label = parseLabel(input.label);
      const contacts = this.list();
      if (contacts.some((contact) => contact.address === address)) {
        throw new ContactBookValidationError("A contact with this address already exists");
      }
      contacts.push({ address, label, addedAt: this.now() });
      return contacts;
    });
  }

  update(payload: unknown): Promise<ContactBookSnapshot> {
    return this.mutate(() => {
      const input = this.requireObject(payload);
      const address = parseAddress(input.address);
      const label = parseLabel(input.label);
      const contacts = this.list();
      const contact = contacts.find((candidate) => candidate.address === address);
      if (!contact) {
        throw new ContactBookValidationError("Contact not found");
      }
      contact.label = label;
      return contacts;
    });
  }

  delete(payload: unknown): Promise<ContactBookSnapshot> {
    return this.mutate(() => {
      const input = this.requireObject(payload);
      const address = parseAddress(input.address);
      const contacts = this.list();
      const next = contacts.filter((contact) => contact.address !== address);
      if (next.length === contacts.length) {
        throw new ContactBookValidationError("Contact not found");
      }
      return next;
    });
  }

  private async mutate(operation: () => SavedContact[]): Promise<ContactBookSnapshot> {
    const predecessor = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;

    try {
      const previous = this.snapshot();
      const contacts = operation();
      const revision = previous.revision + 1;
      this.persistence.update({
        contacts: cloneContacts(contacts),
        contactsRevision: revision,
      });
      try {
        await this.persistence.saveNow();
      } catch (error) {
        // Do not let a failed storage write look successful in the popup, and
        // do not leave an uncommitted contact visible in the in-memory state.
        this.persistence.update({
          contacts: previous.contacts,
          contactsRevision: previous.revision,
        });
        throw error;
      }
      const authoritative = this.snapshot();
      await this.broadcast(authoritative);
      return authoritative;
    } finally {
      release();
    }
  }

  private requireObject(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ContactBookValidationError("Contact payload must be an object");
    }
    return payload as Record<string, unknown>;
  }
}
