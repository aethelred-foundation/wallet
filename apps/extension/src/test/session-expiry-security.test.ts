import { describe, expect, it } from "vitest";
import { SessionManager } from "@aethelred/wallet-connect";

describe("SessionManager expiry authority", () => {
  it("revokes at expiresAt and exposes one cleanup transition", () => {
    const sessions = new SessionManager();
    const session = sessions.createSession({
      appId: "expiry-test",
      appName: "Expiry Test",
      origin: "https://expiry.test",
      trustLevel: "unverified",
      permissions: ["eth_accounts"],
      accountAddresses: ["0x1111111111111111111111111111111111111111"],
      expiresAt: 1_000,
    });

    expect(sessions.getByOrigin(session.origin, 999)?.id).toBe(session.id);
    expect(sessions.getByOrigin(session.origin, 1_000)).toBeUndefined();
    expect(sessions.get(session.id, 1_000)?.status).toBe("revoked");
    expect(sessions.drainExpiredRevocations().map((entry) => entry.id)).toEqual([
      session.id,
    ]);
    expect(sessions.drainExpiredRevocations()).toEqual([]);
  });
});
