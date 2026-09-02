import type { ScopedProviderEventMessage } from "./provider-event-scope";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Content-script defense in depth. This module is deliberately content-only:
 * sharing its runtime code with the background entry makes Rollup emit a
 * static import in `content.js`, but manifest content scripts are classic
 * scripts and cannot execute top-level ESM imports.
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
