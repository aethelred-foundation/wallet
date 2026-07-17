import { afterEach, describe, expect, it, vi } from "vitest";
import { initContentBridge } from "../content-bridge";
import {
  isScopedProviderEventForOrigin,
  planProviderEventDeliveries,
  planRevokedAccountsDelivery,
  tabMatchesProviderEventOrigin,
  type ProviderEventSessionLike,
  type ScopedProviderEventMessage,
} from "../provider-event-scope";

const NOW = 1_800_000_000_000;
const ACCOUNT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DERIVED_ACCOUNT = "0xcccccccccccccccccccccccccccccccccccccccc";

function session(
  id: string,
  origin: string,
  accountAddresses: string[],
  overrides: Partial<ProviderEventSessionLike> = {},
): ProviderEventSessionLike {
  return {
    id,
    origin,
    permissions: ["eth_accounts", "eth_sendTransaction"],
    accountAddresses,
    status: "active",
    ...overrides,
  };
}

describe("provider event session privacy", () => {
  it("produces no account, lock, chain, or message activity without an active session", () => {
    expect(planProviderEventDeliveries([], "accountsChanged", [ACCOUNT_A], { now: NOW })).toEqual([]);
    expect(planProviderEventDeliveries([], "disconnect", { code: 4900 }, { now: NOW })).toEqual([]);
    expect(planProviderEventDeliveries([], "chainChanged", "0x1", { now: NOW })).toEqual([]);
    expect(planProviderEventDeliveries([], "message", { secret: true }, { now: NOW })).toEqual([]);
  });

  it("targets only tabs whose browser URL belongs to the authorized session origin", () => {
    expect(tabMatchesProviderEventOrigin(
      "https://connected.example/app/records",
      "https://connected.example",
    )).toBe(true);
    expect(tabMatchesProviderEventOrigin(
      "https://unconnected.example/app/records",
      "https://connected.example",
    )).toBe(false);
    expect(tabMatchesProviderEventOrigin(undefined, "https://connected.example")).toBe(false);
  });

  it("scopes unlock accounts independently across origins with different grants", () => {
    const sessions = [
      session("session-a", "https://a.example", [ACCOUNT_A]),
      session("session-b", "https://b.example", [ACCOUNT_B]),
    ];

    const deliveries = planProviderEventDeliveries(
      sessions,
      "accountsChanged",
      [ACCOUNT_A, ACCOUNT_B],
      { now: NOW },
    );

    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].target).toEqual(expect.objectContaining({
      origin: "https://a.example",
      sessionId: "session-a",
    }));
    expect(deliveries[0].message.payload.data).toEqual([ACCOUNT_A]);
    expect(deliveries[1].target).toEqual(expect.objectContaining({
      origin: "https://b.example",
      sessionId: "session-b",
    }));
    expect(deliveries[1].message.payload.data).toEqual([ACCOUNT_B]);
  });

  it("returns only the selected account when granted and [] when selection is outside a grant", () => {
    const sessions = [
      session("session-a", "https://a.example", [ACCOUNT_A]),
      session("session-b", "https://b.example", [ACCOUNT_B]),
    ];

    const selectedA = planProviderEventDeliveries(
      sessions,
      "accountsChanged",
      [ACCOUNT_A],
      { now: NOW },
    );
    expect(selectedA.map((delivery) => delivery.message.payload.data)).toEqual([
      [ACCOUNT_A],
      [],
    ]);

    const selectedOutsideBoth = planProviderEventDeliveries(
      sessions,
      "accountsChanged",
      [DERIVED_ACCOUNT],
      { now: NOW },
    );
    expect(selectedOutsideBoth.map((delivery) => delivery.message.payload.data)).toEqual([[], []]);
  });

  it("never includes a newly-derived address that was not added to the exact session grant", () => {
    const existing = session("session-a", "https://a.example", [ACCOUNT_A]);
    const [delivery] = planProviderEventDeliveries(
      [existing],
      "accountsChanged",
      [ACCOUNT_A, DERIVED_ACCOUNT],
      { now: NOW },
    );

    expect(delivery.message.payload.data).toEqual([ACCOUNT_A]);
    expect(delivery.message.payload.data).not.toContain(DERIVED_ACCOUNT);
  });

  it("sends chain changes only to non-expired active sessions", () => {
    const deliveries = planProviderEventDeliveries(
      [
        session("active", "https://active.example", [ACCOUNT_A]),
        session("expired", "https://expired.example", [ACCOUNT_A], { expiresAt: NOW }),
        session("revoked", "https://revoked.example", [ACCOUNT_A], { status: "revoked" }),
      ],
      "chainChanged",
      "0x1ca4",
      { now: NOW },
    );

    expect(deliveries.map((delivery) => delivery.target.sessionId)).toEqual(["active"]);
  });

  it("keeps tx/subscription messages on the exact initiating session and authorized account", () => {
    const sessions = [
      session("session-a", "https://a.example", [ACCOUNT_A]),
      session("session-b", "https://b.example", [ACCOUNT_B]),
    ];
    const txUpdate = { type: "aethelred:tx-updated", data: { hash: "0x123" } };

    expect(planProviderEventDeliveries(sessions, "message", txUpdate, { now: NOW })).toEqual([]);
    expect(planProviderEventDeliveries(
      sessions,
      "message",
      txUpdate,
      { now: NOW, exactSessionId: "session-a", requiredAccount: ACCOUNT_A },
    ).map((delivery) => delivery.target.sessionId)).toEqual(["session-a"]);
    expect(planProviderEventDeliveries(
      sessions,
      "message",
      txUpdate,
      { now: NOW, exactSessionId: "session-a", requiredAccount: ACCOUNT_B },
    )).toEqual([]);
  });

  it("permits only an origin-bound accountsChanged([]) event after revoke", () => {
    const revoked = session("session-a", "https://a.example", [ACCOUNT_A], { status: "revoked" });
    const delivery = planRevokedAccountsDelivery(revoked, NOW);

    expect(isScopedProviderEventForOrigin(delivery.message, "https://a.example")).toBe(true);
    expect(isScopedProviderEventForOrigin(delivery.message, "https://b.example")).toBe(false);
    expect(delivery.message.payload).toEqual(expect.objectContaining({
      event: "accountsChanged",
      data: [],
      authorization: expect.objectContaining({ status: "revoked", sessionId: "session-a" }),
    }));

    const malformedRevocation = structuredClone(delivery.message);
    malformedRevocation.payload.data = [ACCOUNT_A];
    expect(isScopedProviderEventForOrigin(malformedRevocation, "https://a.example")).toBe(false);
  });
});

describe("content bridge provider-event defense", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      writable: true,
      value: originalChrome,
    });
  });

  it("drops internal state/lock broadcasts and unauthenticated or cross-origin provider events", () => {
    let runtimeListener: ((message: unknown) => void) | undefined;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      writable: true,
      value: {
        runtime: {
          lastError: undefined,
          sendMessage: vi.fn(),
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              runtimeListener = listener;
            },
          },
        },
      },
    });
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    initContentBridge();
    expect(runtimeListener).toBeDefined();

    runtimeListener!({ kind: "state-update", payload: { accounts: [ACCOUNT_A] } });
    runtimeListener!({ kind: "lock-state", payload: { locked: true } });
    runtimeListener!({
      kind: "provider-event",
      payload: { event: "accountsChanged", data: [ACCOUNT_A] },
    });

    const currentOrigin = window.location.origin;
    const [validDelivery] = planProviderEventDeliveries(
      [session("session-local", currentOrigin, [ACCOUNT_A])],
      "accountsChanged",
      [ACCOUNT_A],
      { now: NOW },
    );
    const wrongOrigin = structuredClone(validDelivery.message) as ScopedProviderEventMessage;
    wrongOrigin.payload.authorization.origin = "https://attacker.example";
    runtimeListener!(wrongOrigin);
    expect(postMessage).not.toHaveBeenCalled();

    runtimeListener!(validDelivery.message);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          kind: "provider-event",
          payload: expect.objectContaining({
            event: "accountsChanged",
            data: [ACCOUNT_A],
          }),
        }),
      }),
      "*",
    );
    const relayed = postMessage.mock.calls[0][0] as {
      message: { payload: Record<string, unknown> };
    };
    expect(relayed.message.payload).not.toHaveProperty("authorization");
  });
});
