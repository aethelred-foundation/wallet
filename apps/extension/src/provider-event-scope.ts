/**
 * Privacy boundary for EIP-1193 events leaving the extension.
 *
 * A provider event is not a runtime-wide broadcast. Every delivery is bound
 * to one exact, active session and carries the browser origin that the
 * content bridge must match before relaying anything into page world.
 */

export interface ProviderEventSessionLike {
  id: string;
  origin: string;
  permissions: readonly string[];
  accountAddresses: readonly string[];
  status: "active" | "pending" | "revoked";
  expiresAt?: number;
}

export interface ProviderEventAuthorization {
  origin: string;
  sessionId: string;
  status: "active" | "revoked";
}

export interface ScopedProviderEventMessage {
  kind: "provider-event";
  correlationId: "";
  payload: {
    event: string;
    data: unknown;
    authorization: ProviderEventAuthorization;
  };
  timestamp: number;
}

export interface ProviderEventDelivery {
  target: ProviderEventAuthorization;
  requiredAccount?: string;
  message: ScopedProviderEventMessage;
}

export interface ProviderEventPlanOptions {
  now?: number;
  /** Restrict delivery to the exact session that initiated an operation. */
  exactSessionId?: string;
  /** Require that the exact session grant includes this transaction account. */
  requiredAccount?: string;
}

/** Browser-owned tab URL check used immediately before tabs.sendMessage. */
export function tabMatchesProviderEventOrigin(
  tabUrl: string | undefined,
  targetOrigin: string,
): boolean {
  if (!tabUrl) return false;
  try {
    return new URL(tabUrl).origin === targetOrigin;
  } catch {
    return false;
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function sessionCanReadAccounts(session: ProviderEventSessionLike): boolean {
  return (
    session.permissions.includes("accounts") ||
    session.permissions.includes("eth_accounts")
  );
}

export function isProviderSessionActive(
  session: ProviderEventSessionLike,
  now = Date.now(),
): boolean {
  return (
    session.status === "active" &&
    (session.expiresAt == null || session.expiresAt > now)
  );
}

/**
 * Intersect a proposed accountsChanged value with the exact session grant.
 * Grant casing is retained and duplicates are removed. No address outside the
 * grant can enter an event even if a caller accidentally passes the keyring.
 */
export function intersectGrantedAccounts(
  proposedAccounts: readonly string[],
  grantedAccounts: readonly string[],
): string[] {
  const result: string[] = [];
  for (const proposed of proposedAccounts) {
    const granted = grantedAccounts.find((address) => sameAddress(address, proposed));
    if (granted && !result.some((address) => sameAddress(address, granted))) {
      result.push(granted);
    }
  }
  return result;
}

function makeMessage(
  target: ProviderEventAuthorization,
  event: string,
  data: unknown,
  timestamp: number,
): ScopedProviderEventMessage {
  return {
    kind: "provider-event",
    correlationId: "",
    payload: { event, data, authorization: target },
    timestamp,
  };
}

/**
 * Build active-session deliveries for a provider event.
 *
 * `message` events are intentionally fail-closed unless an exact initiating
 * session is supplied. That prevents transaction/subscription activity from
 * ever regressing into a connected-site-wide fan-out.
 */
export function planProviderEventDeliveries(
  sessions: readonly ProviderEventSessionLike[],
  event: string,
  data: unknown,
  options: ProviderEventPlanOptions = {},
): ProviderEventDelivery[] {
  const now = options.now ?? Date.now();
  if (event === "message" && !options.exactSessionId) return [];

  return sessions
    .filter((session) => isProviderSessionActive(session, now))
    .filter((session) => !options.exactSessionId || session.id === options.exactSessionId)
    .filter((session) =>
      !options.requiredAccount ||
      session.accountAddresses.some((address) => sameAddress(address, options.requiredAccount!)),
    )
    .flatMap((session): ProviderEventDelivery[] => {
      let scopedData = data;
      if (event === "accountsChanged") {
        if (!sessionCanReadAccounts(session) || !Array.isArray(data)) return [];
        const proposed = data.filter((value): value is string => typeof value === "string");
        scopedData = intersectGrantedAccounts(proposed, session.accountAddresses);
      }

      const target: ProviderEventAuthorization = {
        origin: session.origin,
        sessionId: session.id,
        status: "active",
      };
      return [{
        target,
        requiredAccount: options.requiredAccount,
        message: makeMessage(target, event, scopedData, now),
      }];
    });
}

/** Create the sole event allowed after revocation: accountsChanged([]). */
export function planRevokedAccountsDelivery(
  session: ProviderEventSessionLike,
  now = Date.now(),
): ProviderEventDelivery {
  const target: ProviderEventAuthorization = {
    origin: session.origin,
    sessionId: session.id,
    status: "revoked",
  };
  return {
    target,
    message: makeMessage(target, "accountsChanged", [], now),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Content-script defense in depth. Runtime messages without an exact session
 * binding, messages for another frame origin, and malformed/revoked event
 * shapes are dropped before page-world postMessage.
 */
export function isScopedProviderEventForOrigin(
  value: unknown,
  currentOrigin: string,
): value is ScopedProviderEventMessage {
  if (!isRecord(value) || value.kind !== "provider-event" || !isRecord(value.payload)) {
    return false;
  }
  const { event, data, authorization } = value.payload;
  if (
    typeof event !== "string" ||
    !isRecord(authorization) ||
    authorization.origin !== currentOrigin ||
    typeof authorization.sessionId !== "string" ||
    authorization.sessionId.length === 0 ||
    (authorization.status !== "active" && authorization.status !== "revoked")
  ) {
    return false;
  }

  if (authorization.status === "revoked") {
    return event === "accountsChanged" && Array.isArray(data) && data.length === 0;
  }

  if (event === "accountsChanged") {
    return Array.isArray(data) && data.every((address) => typeof address === "string");
  }
  return true;
}
