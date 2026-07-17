import type { SessionSummary, TrustLevel } from "./contracts";

export interface SessionGrant {
  id: string;
  appId: string;
  appName: string;
  origin: string;
  trustLevel: TrustLevel;
  permissions: string[];
  accountAddresses: string[];
  createdAt: number;
  expiresAt?: number;
  status: "active" | "pending" | "revoked";
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `session-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * SessionManager tracks active dApp sessions per origin.
 * A session represents a granted connection between an app and the wallet.
 */
export class SessionManager {
  private sessions = new Map<string, SessionGrant>();
  private expiredRevocations = new Set<string>();

  private expire(session: SessionGrant, now: number): void {
    if (
      session.status === "active" &&
      session.expiresAt != null &&
      session.expiresAt <= now
    ) {
      session.status = "revoked";
      this.expiredRevocations.add(session.id);
    }
  }

  createSession(opts: {
    appId: string;
    appName: string;
    origin: string;
    trustLevel: TrustLevel;
    permissions: string[];
    accountAddresses: string[];
    expiresAt?: number;
  }): SessionGrant {
    // Revoke any existing session for this origin
    const existing = this.getByOrigin(opts.origin);
    if (existing) {
      this.revoke(existing.id);
    }

    const session: SessionGrant = {
      id: generateSessionId(),
      ...opts,
      createdAt: Date.now(),
      status: "active",
    };

    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string, now = Date.now()): SessionGrant | undefined {
    const session = this.sessions.get(id);
    if (session) this.expire(session, now);
    return session;
  }

  getByOrigin(origin: string, now = Date.now()): SessionGrant | undefined {
    this.revokeExpired(now);
    return Array.from(this.sessions.values()).find(
      (s) => s.origin === origin && s.status === "active"
    );
  }

  list(): SessionGrant[] {
    return Array.from(this.sessions.values());
  }

  listActive(now = Date.now()): SessionGrant[] {
    this.revokeExpired(now);
    return this.list().filter((s) => s.status === "active");
  }

  /**
   * Revoke expired grants synchronously and return only those changed by this
   * call. The background uses the returned sessions to stop subscriptions,
   * reject pending approvals, persist cleanup, and emit the final empty
   * accounts event without ever treating an expired grant as active.
   */
  revokeExpired(now = Date.now()): SessionGrant[] {
    const revoked: SessionGrant[] = [];
    for (const session of this.sessions.values()) {
      const wasActive = session.status === "active";
      this.expire(session, now);
      if (wasActive && session.status === "revoked") {
        revoked.push(session);
      }
    }
    return revoked;
  }

  /** Drain expiry transitions that still need background-side cleanup. */
  drainExpiredRevocations(): SessionGrant[] {
    const sessions = Array.from(this.expiredRevocations)
      .map((id) => this.sessions.get(id))
      .filter((session): session is SessionGrant => session != null);
    this.expiredRevocations.clear();
    return sessions;
  }

  revoke(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = "revoked";
    }
  }

  revokeByOrigin(origin: string): void {
    for (const session of this.sessions.values()) {
      if (session.origin === origin && session.status === "active") {
        session.status = "revoked";
      }
    }
  }

  toSummaries(): SessionSummary[] {
    return this.listActive().map((s) => ({
      id: s.id,
      appName: s.appName,
      origin: s.origin,
      trustLevel: s.trustLevel,
      permissions: s.permissions,
      status: s.status,
      createdAt: s.createdAt,
    }));
  }

  loadFromSnapshot(sessions: SessionGrant[]): void {
    this.sessions.clear();
    this.expiredRevocations.clear();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }

  toSnapshot(): SessionGrant[] {
    return this.list();
  }
}
