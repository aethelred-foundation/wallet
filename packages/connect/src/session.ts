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

  createSession(opts: {
    appId: string;
    appName: string;
    origin: string;
    trustLevel: TrustLevel;
    permissions: string[];
    accountAddresses: string[];
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

  get(id: string): SessionGrant | undefined {
    return this.sessions.get(id);
  }

  getByOrigin(origin: string): SessionGrant | undefined {
    return Array.from(this.sessions.values()).find(
      (s) => s.origin === origin && s.status === "active"
    );
  }

  list(): SessionGrant[] {
    return Array.from(this.sessions.values());
  }

  listActive(): SessionGrant[] {
    return this.list().filter((s) => s.status === "active");
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
    }));
  }

  loadFromSnapshot(sessions: SessionGrant[]): void {
    this.sessions.clear();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }

  toSnapshot(): SessionGrant[] {
    return this.list();
  }
}
