/**
 * State persistence layer using chrome.storage.local or IndexedDB.
 * Ensures wallet state survives service worker restarts and extension updates.
 */

export interface WalletPersistentState {
  // Identity
  subjects: unknown[];
  activeSubjectId: string | null;
  workspaces: unknown[];
  workspaceRoles: unknown[];
  activeWorkspaceId: string | null;
  credentials: unknown[];

  // Sessions
  sessions: unknown[];

  // Transactions
  pendingTransactions: unknown[];

  // Approvals
  approvalRequests: unknown[];
  spendLimits: unknown[];

  // Deployment
  deploymentTier: string;
  serviceIdentities: unknown[];
  agentIdentities: unknown[];

  // Custom tokens
  customTokens: unknown[];

  // Contacts
  contacts: unknown[];

  // Audit
  auditSequence: number;
  auditLastHash: string;

  // Preferences
  theme: "light" | "dark" | "system";
  autoLockMs: number;
  activeChainId: string;

  // Version for migration
  version: number;
  lastSavedAt: number;
}

export const WALLET_STATE_STORAGE_KEY = "aethelred-wallet-state";
const CURRENT_VERSION = 2;
const MIGRATABLE_VERSIONS = new Set([1, 2]);

/**
 * Runtime validation error thrown when persisted state fails schema
 * checks on load. Used to trigger a fall-back to default state plus
 * an audit-log entry instead of silently propagating garbage.
 */
export class StateValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`State persistence validation failed at "${field}": ${message}`);
    this.name = "StateValidationError";
    this.field = field;
  }
}

/**
 * Minimal hand-rolled validator. Each field is checked for presence
 * and type; unknown fields are tolerated (forward-compat). Throws
 * `StateValidationError` on the first failure with the field path.
 */
function validateState(raw: unknown): asserts raw is Partial<WalletPersistentState> {
  if (!raw || typeof raw !== "object") {
    throw new StateValidationError("root", "expected object, got " + typeof raw);
  }
  const o = raw as Record<string, unknown>;
  const checkArray = (name: string) => {
    if (o[name] != null && !Array.isArray(o[name])) {
      throw new StateValidationError(name, "expected array");
    }
  };
  const checkString = (name: string) => {
    if (o[name] != null && typeof o[name] !== "string") {
      throw new StateValidationError(name, "expected string");
    }
  };
  const checkNumber = (name: string) => {
    if (o[name] != null && typeof o[name] !== "number") {
      throw new StateValidationError(name, "expected number");
    }
  };
  checkArray("subjects");
  checkArray("workspaces");
  checkArray("workspaceRoles");
  checkArray("credentials");
  checkArray("sessions");
  checkArray("pendingTransactions");
  checkArray("approvalRequests");
  checkArray("spendLimits");
  checkArray("serviceIdentities");
  checkArray("agentIdentities");
  checkArray("customTokens");
  checkArray("contacts");
  checkString("activeSubjectId");
  checkString("activeWorkspaceId");
  checkString("deploymentTier");
  checkString("theme");
  checkString("activeChainId");
  checkString("auditLastHash");
  checkNumber("autoLockMs");
  checkNumber("auditSequence");
  checkNumber("version");
  checkNumber("lastSavedAt");
  // version check
  if (o.version != null && typeof o.version === "number" && !MIGRATABLE_VERSIONS.has(o.version)) {
    throw new StateValidationError(
      "version",
      `unsupported schema version ${o.version} — supported versions: ${[...MIGRATABLE_VERSIONS].join(", ")}`,
    );
  }
}

/**
 * Run version-aware migrations on a loaded state. Currently we only
 * support v1→v2 which is additive (nothing to migrate); if we ever
 * need breaking changes we add them here. Unknown versions throw.
 */
function migrateState(raw: Partial<WalletPersistentState>): WalletPersistentState {
  const version = (raw.version as number | undefined) ?? 1;
  if (version === CURRENT_VERSION) {
    return { ...getDefaultState(), ...raw, version: CURRENT_VERSION };
  }
  if (version === 1) {
    // v1 → v2: no breaking changes; just stamp the new version
    return { ...getDefaultState(), ...raw, version: CURRENT_VERSION };
  }
  throw new StateValidationError("version", `no migration path from v${version} to v${CURRENT_VERSION}`);
}

function getDefaultState(): WalletPersistentState {
  return {
    subjects: [],
    activeSubjectId: null,
    workspaces: [],
    workspaceRoles: [],
    activeWorkspaceId: null,
    credentials: [],
    sessions: [],
    pendingTransactions: [],
    approvalRequests: [],
    spendLimits: [],
    deploymentTier: "shared-cloud",
    serviceIdentities: [],
    agentIdentities: [],
    customTokens: [],
    contacts: [],
    auditSequence: 0,
    auditLastHash: "0000000000000000000000000000000000000000000000000000000000000000",
    theme: "system",
    autoLockMs: 5 * 60 * 1000,
    activeChainId: "0x1",
    version: CURRENT_VERSION,
    lastSavedAt: 0,
  };
}

interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Persists wallet state to durable storage.
 * Debounces saves to avoid excessive writes.
 */
export class StatePersistence {
  private state: WalletPersistentState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(private readonly storage: StorageBackend) {
    this.state = getDefaultState();
  }

  /**
   * Load persisted state from storage with runtime validation + version
   * migration. On validation failure, falls back to a fresh default
   * state and logs a warning — the alternative (accepting malformed
   * state into `loadFromSnapshot`) would silently corrupt every package
   * on startup.
   */
  async load(): Promise<WalletPersistentState> {
    try {
      const raw = await this.storage.get(WALLET_STATE_STORAGE_KEY);
      if (!raw) {
        this.state = getDefaultState();
        return this.state;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.warn("[StatePersistence] corrupted JSON, resetting to defaults", err);
        this.state = getDefaultState();
        return this.state;
      }
      try {
        validateState(parsed);
      } catch (err) {
        console.warn("[StatePersistence] validation failed, resetting to defaults", err);
        this.state = getDefaultState();
        return this.state;
      }
      try {
        this.state = migrateState(parsed);
      } catch (err) {
        console.warn("[StatePersistence] migration failed, resetting to defaults", err);
        this.state = getDefaultState();
      }
    } catch (err) {
      console.warn("[StatePersistence] storage read failed, using defaults", err);
      this.state = getDefaultState();
    }
    return this.state;
  }

  getState(): WalletPersistentState {
    return this.state;
  }

  update(partial: Partial<WalletPersistentState>): void {
    Object.assign(this.state, partial);
    this.dirty = true;
    this.scheduleSave();
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.state.lastSavedAt = Date.now();
    const serialized = JSON.stringify(this.state);
    await this.storage.set(WALLET_STATE_STORAGE_KEY, serialized);
    this.dirty = false;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow().catch(() => {
        // Retry on next update
        this.dirty = true;
      });
    }, 500); // Debounce 500ms
  }
}
