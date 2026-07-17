import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackgroundHarness,
  type BackgroundHarness,
  type SensitivePrimitiveContext,
} from "./harness";
import type { PolicyBundle } from "@aethelred/wallet-policy";

const ORIGIN = "https://authority-test.example";
const RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";

function nativeIntent(
  address: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "native-authority-intent",
    kind: "sign-message",
    method: "sign-message",
    app: {
      id: "cruzible",
      name: "Cruzible",
      origin: ORIGIN,
      trustLevel: "first-party",
    },
    payload: { message: "hello", from: address },
    ...overrides,
  };
}

const ALLOW_ALL_POLICY: PolicyBundle = {
  id: "allow-all-test",
  name: "Allow all test policy",
  mode: "guided",
  workspaceKind: "personal",
  rules: [],
  version: 1,
  createdAt: 1,
};

describe("dApp signing session authority", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness({ enforceSessionAuthority: true });
  });

  afterEach(async () => {
    await harness.dispose();
  });

  async function approvePendingRequest(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [approval] = harness.getPendingApprovals();
    expect(approval).toBeDefined();
    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "approved",
    });
  }

  async function connect(): Promise<{ address: string; sessionId: string }> {
    const pendingConnection = harness.sendMessage(
      "rpc-request",
      { method: "eth_requestAccounts", params: [] },
      ORIGIN,
    );
    await approvePendingRequest();
    const connection = await pendingConnection;
    const [address] = connection.payload.result as string[];

    const state = await harness.sendMessage("get-state", {});
    const sessions = (state.payload.result as {
      sessions: Array<{ id: string; origin: string }>;
    }).sessions;
    const session = sessions.find((candidate) => candidate.origin === ORIGIN);
    expect(session).toBeDefined();
    return { address, sessionId: session!.id };
  }

  async function grantCapability(capability: string): Promise<string> {
    const pendingPermission = harness.sendMessage(
      "rpc-request",
      {
        method: "wallet_requestPermissions",
        params: [{ [capability]: {} }],
      },
      ORIGIN,
    );
    await approvePendingRequest();
    const permissionResult = await pendingPermission;
    expect(permissionResult.payload.error).toBeUndefined();

    const state = await harness.sendMessage("get-state", {});
    const session = (state.payload.result as {
      sessions: Array<{ id: string; origin: string }>;
    }).sessions.find((candidate) => candidate.origin === ORIGIN);
    expect(session).toBeDefined();
    return session!.id;
  }

  it("rejects native signing and state reads before the browser origin has a session", async () => {
    const [account] = harness.getKnownAccounts();
    const state = await harness.sendMessage(
      "rpc-request",
      { method: "aethelred_getState", params: [] },
      ORIGIN,
    );
    expect(state.payload.error).toEqual(expect.objectContaining({ code: 4100 }));

    const signing = await harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [nativeIntent(account.address)] },
      ORIGIN,
    );
    expect(signing.payload.error).toEqual(expect.objectContaining({ code: 4100 }));
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });
  });

  it("returns only approved accounts and chain/lock state to a connected page", async () => {
    const { address } = await connect();
    const response = await harness.sendMessage(
      "rpc-request",
      { method: "aethelred_getState", params: [] },
      ORIGIN,
    );

    expect(response.payload.error).toBeUndefined();
    expect(response.payload.result).toEqual({
      locked: false,
      chainId: "0xaa36a7",
      accounts: [address],
    });
    expect(response.payload.result).not.toEqual(expect.objectContaining({ sessions: expect.anything() }));
    expect(response.payload.result).not.toEqual(expect.objectContaining({ pendingApprovals: expect.anything() }));
    expect(response.payload.result).not.toEqual(expect.objectContaining({ subject: expect.anything() }));
  });

  it("derives native app trust from the authenticated origin and rejects origin mismatch", async () => {
    const denyUnverifiedPolicy: PolicyBundle = {
      ...ALLOW_ALL_POLICY,
      id: "deny-unverified-test",
      rules: [{
        id: "deny-unverified",
        name: "Deny unverified native signing",
        priority: 1,
        conditions: [
          { field: "intent.kind", operator: "equals", value: "sign-message" },
          { field: "app.trustLevel", operator: "equals", value: "unverified" },
        ],
        outcome: "deny",
        message: "Unverified app denied",
      }],
    };
    await harness.dispose();
    harness = await createBackgroundHarness({
      enforceSessionAuthority: true,
      seedPolicy: denyUnverifiedPolicy,
    });
    const { address } = await connect();
    await grantCapability("sign-message");

    const spoofedTrust = await harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [nativeIntent(address)] },
      ORIGIN,
    );
    expect(spoofedTrust.payload.error?.message).toMatch(/unverified app denied/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });

    const mismatchedOrigin = await harness.sendMessage(
      "rpc-request",
      {
        method: "aethelred_requestIntent",
        params: [nativeIntent(address, {
          app: {
            id: "cruzible",
            name: "Cruzible",
            origin: "https://cruzible.aethelred.org",
            trustLevel: "first-party",
          },
        })],
      },
      ORIGIN,
    );
    expect(mismatchedOrigin.payload.error).toEqual(expect.objectContaining({ code: 4100 }));
    expect(mismatchedOrigin.payload.error?.message).toMatch(/origin does not match/i);
  });

  it("requires a fresh explicit approval for every native message signature even when policy allows", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({
      enforceSessionAuthority: true,
      seedPolicy: ALLOW_ALL_POLICY,
    });
    const { address } = await connect();
    await grantCapability("sign-message");

    const rejectedRequest = harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [nativeIntent(address)] },
      ORIGIN,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [approval] = harness.getPendingApprovals();
    expect(approval).toBeDefined();
    expect(approval.appName).toBe(ORIGIN);
    expect(approval.appOrigin).toBe(ORIGIN);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });
    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "rejected",
    });
    const rejected = await rejectedRequest;
    expect(rejected.payload.error).toEqual(expect.objectContaining({ code: 4001 }));
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });

    const approvedRequest = harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [nativeIntent(address)] },
      ORIGIN,
    );
    await approvePendingRequest();
    const approved = await approvedRequest;
    expect(approved.payload.error).toBeUndefined();
    expect(approved.payload.result).toEqual(expect.objectContaining({
      result: expect.objectContaining({ signature: expect.stringMatching(/^0x[0-9a-f]{130}$/i) }),
    }));
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 1, broadcast: 0 });
  });

  it("cannot revive a native signature by reconnecting while its approval is pending", async () => {
    const { address } = await connect();
    const sessionId = await grantCapability("sign-message");
    const pending = harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [nativeIntent(address)] },
      ORIGIN,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.getPendingApprovals()).toHaveLength(1);

    const revoked = await harness.sendMessage("revoke-session", { sessionId });
    expect(revoked.payload.result).toEqual({ ok: true });
    const replacement = await connect();
    await grantCapability("sign-message");
    expect(replacement.sessionId).not.toBe(sessionId);

    const stale = await pending;
    expect(stale.payload.error).toEqual(expect.objectContaining({ code: 4001 }));
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });
  });

  it("requires approval for a new native connection and never reports unsupported intents as allowed", async () => {
    const [account] = harness.getKnownAccounts();
    const connectIntent = {
      id: "native-connect",
      kind: "connect",
      method: "connect",
      app: {
        id: "cruzible",
        name: "Cruzible",
        origin: ORIGIN,
        trustLevel: "first-party",
      },
      payload: {},
    };
    const pendingConnect = harness.sendMessage(
      "rpc-request",
      { method: "aethelred_requestIntent", params: [connectIntent] },
      ORIGIN,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [approval] = harness.getPendingApprovals();
    expect(approval).toBeDefined();
    expect(approval.appName).toBe(ORIGIN);
    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "approved",
    });
    const connected = await pendingConnect;
    expect(connected.payload.error).toBeUndefined();
    expect(connected.payload.result).toEqual(expect.objectContaining({
      outcome: expect.stringMatching(/allow|warn/),
      result: { accounts: [account.address] },
    }));
    const internalState = await harness.sendMessage("get-state", {});
    expect(internalState.payload.result).toEqual(expect.objectContaining({
      sessions: [expect.objectContaining({
        appName: ORIGIN,
        trustLevel: "unverified",
        permissions: expect.arrayContaining(["accounts", "sign-message"]),
      })],
    }));

    const unsupported = await harness.sendMessage(
      "rpc-request",
      {
        method: "aethelred_requestIntent",
        params: [{ ...connectIntent, kind: "switch-workspace", method: "switch-workspace" }],
      },
      ORIGIN,
    );
    expect(unsupported.payload.error).toEqual(expect.objectContaining({ code: 4200 }));
    expect(unsupported.payload.result).toBeUndefined();
  });

  it("lets an active least-privilege session send only from its granted account", async () => {
    const { address } = await connect();

    // eth_requestAccounts grants eth_sendTransaction, but not arbitrary
    // message signing. The send reaches the approval queue.
    harness.stubNextBroadcast("0x" + "77".repeat(32) as `0x${string}`);
    const pendingSend = harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{ from: address, to: RECIPIENT, value: "0x1" }],
      },
      ORIGIN,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.getPendingApprovals()).toHaveLength(1);
    await approvePendingRequest();
    const sent = await pendingSend;
    expect(sent.payload.error).toBeUndefined();
    expect(sent.payload.result).toBe("0x" + "77".repeat(32));

    // Standard EIP-1193 compatibility: eth_accounts is the account-access
    // umbrella, so personal_sign works immediately after connect, but still
    // requires its own explicit approval.
    const pendingInitialSign = harness.sendMessage(
      "rpc-request",
      { method: "personal_sign", params: ["0x68656c6c6f", address] },
      ORIGIN,
    );
    await approvePendingRequest();
    const initialSign = await pendingInitialSign;
    expect(initialSign.payload.error).toBeUndefined();
    expect(initialSign.payload.result).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);

    const initialState = await harness.sendMessage("get-state", {});
    const [initialSession] = (initialState.payload.result as {
      sessions: Array<{ permissions: string[] }>;
    }).sessions;
    expect(initialSession.permissions).toContain("eth_accounts");
    expect(initialSession.permissions).not.toContain("personal_sign");

    // An explicit EIP-2255 permission ceremony amends (rather than silently
    // ignoring) the existing grant. Method-specific capabilities remain
    // available for callers that prefer a narrower explicit grant.
    const pendingPermission = harness.sendMessage(
      "rpc-request",
      {
        method: "wallet_requestPermissions",
        params: [{ personal_sign: {} }],
      },
      ORIGIN,
    );
    await approvePendingRequest();
    const permissionResult = await pendingPermission;
    expect(permissionResult.payload.error).toBeUndefined();

    const stateAfterPermission = await harness.sendMessage("get-state", {});
    const [updatedSession] = (stateAfterPermission.payload.result as {
      sessions: Array<{ permissions: string[] }>;
    }).sessions;
    expect(updatedSession.permissions).toEqual(expect.arrayContaining([
      "eth_sendTransaction",
      "personal_sign",
    ]));

    const pendingSign = harness.sendMessage(
      "rpc-request",
      { method: "personal_sign", params: ["0x68656c6c6f", address] },
      ORIGIN,
    );
    await approvePendingRequest();
    const signed = await pendingSign;
    expect(signed.payload.error).toBeUndefined();
    expect(signed.payload.result).toMatch(/^0x[0-9a-f]{130}$/i);

    const deniedAccount = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: "0x0000000000000000000000000000000000000001",
          to: RECIPIENT,
          value: "0x1",
        }],
      },
      ORIGIN,
    );
    expect(deniedAccount.payload.error?.code).toBe(4100);
    expect(deniedAccount.payload.error?.message).toMatch(/account is not authorized/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
  });

  it("returns 4100 for every supported signing path after the popup revokes the session", async () => {
    const { address, sessionId } = await connect();

    // Revocation also cancels an approval that was already waiting. It must
    // not be possible to disconnect the site and later approve a stale card.
    const inFlightSign = harness.sendMessage(
      "rpc-request",
      { method: "personal_sign", params: ["0x68656c6c6f", address] },
      ORIGIN,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.getPendingApprovals()).toHaveLength(1);

    const revoked = await harness.sendMessage("revoke-session", { sessionId });
    expect(revoked.payload.result).toEqual({ ok: true });
    const cancelled = await inFlightSign;
    expect(cancelled.payload.error?.code).toBe(4001);
    expect(harness.getPendingApprovals()).toHaveLength(0);

    const requests: Array<{ method: string; params: unknown[] }> = [
      {
        method: "eth_sendTransaction",
        params: [{ from: address, to: RECIPIENT, value: "0x1" }],
      },
      { method: "personal_sign", params: ["0x68656c6c6f", address] },
      { method: "eth_sign", params: [address, "0x" + "11".repeat(32)] },
      {
        method: "eth_signTypedData_v4",
        params: [address, { types: {}, primaryType: "Mail", domain: {}, message: {} }],
      },
      {
        method: "aethelred_requestIntent",
        params: [{
          kind: "sign-message",
          method: "sign-message",
          app: {
            id: "authority-test",
            name: "Authority Test",
            origin: ORIGIN,
            trustLevel: "unverified",
          },
          payload: { message: "hello", from: address },
        }],
      },
    ];

    for (const request of requests) {
      const response = await harness.sendMessage("rpc-request", request, ORIGIN);
      expect(response.payload.error?.code, request.method).toBe(4100);
      expect(response.payload.error?.message, request.method).toMatch(/not connected/i);
      expect(harness.getPendingApprovals(), request.method).toHaveLength(0);
    }
  });

  it("leaves the popup-owned prepare/execute path independent of dApp sessions", async () => {
    const [account] = harness.getKnownAccounts();
    const prepared = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: RECIPIENT,
      value: "0x1",
      data: "0x",
    });
    expect(prepared.payload.error).toBeUndefined();
    const { draftId } = prepared.payload.result as { draftId: string };

    const hash = "0x" + "88".repeat(32) as `0x${string}`;
    harness.stubNextBroadcast(hash);
    const executed = await harness.sendMessage("execute-tx", { draftId });
    expect(executed.payload.error).toBeUndefined();
    expect((executed.payload.result as { hash: string }).hash).toBe(hash);
  });

  it.each([
    "eth_sendTransaction",
    "personal_sign",
    "eth_signTypedData_v4",
    "aethelred_requestIntent",
  ])(
    "does not let a replacement session revive an approved %s request",
    async (method) => {
      let releasePrimitive!: () => void;
      const primitiveReleased = new Promise<void>((resolve) => {
        releasePrimitive = resolve;
      });
      let primitiveReached!: (context: SensitivePrimitiveContext) => void;
      const reachedPrimitive = new Promise<SensitivePrimitiveContext>((resolve) => {
        primitiveReached = resolve;
      });
      let blocked = false;

      await harness.dispose();
      harness = await createBackgroundHarness({
        enforceSessionAuthority: true,
        // Sovereign mode makes the native sign-message intent enter the same
        // explicit approval pipeline as the EIP-1193 signing methods.
        workspaceKind: "sovereign",
        beforeSensitivePrimitive: async (context) => {
          if (blocked || context.method !== method || context.primitive !== "sign") return;
          blocked = true;
          primitiveReached(context);
          await primitiveReleased;
        },
      });

      const connected = await connect();
      let originalSessionId = connected.sessionId;
      if (method === "aethelred_requestIntent") {
        originalSessionId = await grantCapability("sign-message");
      }

      const typedData = {
        types: {
          EIP712Domain: [],
          Mail: [{ name: "contents", type: "string" }],
        },
        primaryType: "Mail",
        domain: {},
        message: { contents: "hello" },
      };
      const request = method === "eth_sendTransaction"
        ? {
            method,
            params: [{ from: connected.address, to: RECIPIENT, value: "0x1" }],
          }
        : method === "personal_sign"
          ? { method, params: ["0x68656c6c6f", connected.address] }
          : method === "eth_signTypedData_v4"
            ? { method, params: [connected.address, typedData] }
            : {
                method,
                params: [{
                  id: "native-race-intent",
                  kind: "sign-message",
                  method: "sign-message",
                  app: {
                    id: "authority-test",
                    name: "Authority Test",
                    origin: ORIGIN,
                    trustLevel: "unverified",
                  },
                  payload: { message: "hello", from: connected.address },
                }],
              };

      const pendingRequest = harness.sendMessage("rpc-request", request, ORIGIN);
      await approvePendingRequest();
      await reachedPrimitive;

      const revoked = await harness.sendMessage("revoke-session", {
        sessionId: originalSessionId,
      });
      expect(revoked.payload.result).toEqual({ ok: true });

      // Reconnect the same origin while the old request is paused. The new
      // session has valid permissions, but a different ID and must not be
      // inherited by the already-approved request.
      const replacementConnection = await connect();
      let replacementSessionId = replacementConnection.sessionId;
      if (method === "aethelred_requestIntent") {
        replacementSessionId = await grantCapability("sign-message");
      }
      expect(replacementSessionId).not.toBe(originalSessionId);

      releasePrimitive();
      const result = await pendingRequest;
      expect(result.payload.error?.code).toBe(4100);
      expect(result.payload.error?.message).toMatch(/authority.*no longer active/i);
      expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });
      expect(
        harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
      ).toHaveLength(0);
    },
  );

  it.each([
    "personal_sign",
    "eth_signTypedData_v4",
    "aethelred_requestIntent",
  ])(
    "drops a completed %s signature when the exact session is revoked during custody",
    async (method) => {
      let releaseResult!: () => void;
      const resultReleased = new Promise<void>((resolve) => {
        releaseResult = resolve;
      });
      let resultReached!: () => void;
      const reachedResult = new Promise<void>((resolve) => {
        resultReached = resolve;
      });
      let blocked = false;

      await harness.dispose();
      harness = await createBackgroundHarness({
        enforceSessionAuthority: true,
        workspaceKind: "sovereign",
        afterSensitivePrimitive: async (context) => {
          if (
            blocked ||
            context.method !== method ||
            context.primitive !== "sign"
          ) return;
          blocked = true;
          resultReached();
          await resultReleased;
        },
      });

      const connected = await connect();
      let sessionId = connected.sessionId;
      if (method === "aethelred_requestIntent") {
        sessionId = await grantCapability("sign-message");
      }

      const typedData = {
        types: {
          EIP712Domain: [],
          Mail: [{ name: "contents", type: "string" }],
        },
        primaryType: "Mail",
        domain: {},
        message: { contents: "hello" },
      };
      const request = method === "personal_sign"
        ? { method, params: ["0x68656c6c6f", connected.address] }
        : method === "eth_signTypedData_v4"
          ? { method, params: [connected.address, typedData] }
          : {
              method,
              params: [nativeIntent(connected.address, { id: "post-custody-race" })],
            };

      const pending = harness.sendMessage("rpc-request", request, ORIGIN);
      await approvePendingRequest();
      await reachedResult;

      const revoked = await harness.sendMessage("revoke-session", { sessionId });
      expect(revoked.payload.result).toEqual({ ok: true });
      releaseResult();

      const response = await pending;
      expect(response.payload.error?.code).toBe(4100);
      expect(response.payload.result).toBeUndefined();
      expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 1, broadcast: 0 });
    },
  );

  it("revalidates the original session again before transaction broadcast", async () => {
    let releaseBroadcast!: () => void;
    const broadcastReleased = new Promise<void>((resolve) => {
      releaseBroadcast = resolve;
    });
    let broadcastReached!: () => void;
    const reachedBroadcast = new Promise<void>((resolve) => {
      broadcastReached = resolve;
    });

    await harness.dispose();
    harness = await createBackgroundHarness({
      enforceSessionAuthority: true,
      beforeSensitivePrimitive: async ({ method, primitive }) => {
        if (method !== "eth_sendTransaction" || primitive !== "broadcast") return;
        broadcastReached();
        await broadcastReleased;
      },
    });

    const { address, sessionId } = await connect();
    const pendingSend = harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{ from: address, to: RECIPIENT, value: "0x1" }],
      },
      ORIGIN,
    );
    await approvePendingRequest();
    await reachedBroadcast;

    const revoked = await harness.sendMessage("revoke-session", { sessionId });
    expect(revoked.payload.result).toEqual({ ok: true });
    releaseBroadcast();

    const result = await pendingSend;
    expect(result.payload.error?.code).toBe(4100);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 1, broadcast: 0 });
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(0);
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 0,
      valueUsd: 0,
    });
  });
});
