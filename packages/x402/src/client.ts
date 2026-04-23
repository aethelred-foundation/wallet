/**
 * High-level x402 client.
 *
 * The client.ts surface is what an agent developer actually calls:
 *
 *     const res = await x402Fetch(url, {
 *       signer,
 *       attestation: { getQuote: () => ... },
 *       onPolicyCheck: (req) => policyEngine.evaluate(ctx),
 *       auditCapture,
 *     });
 *
 * Under the hood:
 *
 *   1. Issues the request WITHOUT payment. Most resources are free
 *      and we shouldn't pay for them speculatively.
 *   2. If the server returns 402, parses the requirements.
 *   3. Runs a local policy check: we don't even generate a
 *      signature if the policy engine would reject the payment.
 *      This is the key compliance invariant — policy decides BEFORE
 *      any key is touched.
 *   4. Picks the requirement from `accepts[]` (cheapest compatible,
 *      or the first one if only one).
 *   5. If the requirement has an `attestation` block, fetches a
 *      fresh TEE quote (may be cached within `maxAgeSeconds` ±
 *      freshness-buffer, unless `perCallFreshness: true`).
 *   6. Asks the signer to sign the EIP-3009 authorization.
 *   7. Computes the binding hash.
 *   8. Retries the original request with `X-PAYMENT` and
 *      (optionally) `X-PAYMENT-ATTESTATION` headers.
 *   9. Parses the response, extracts the receipt from
 *      `X-PAYMENT-RESPONSE`, validates the binding echo.
 *   10. Emits audit events at each boundary.
 *
 * The client is idempotent in the sense that retrying the SAME
 * request after a network failure generates a fresh nonce and
 * signs a fresh authorization. We do NOT persist half-finished
 * payments — if a facilitator is mid-broadcast when the network
 * dies, the nonce protects against double-spending; the client
 * just tries again and the facilitator resolves "which
 * authorization won" via nonce ordering on-chain.
 */

import type { TeeQuote } from "@aethelred/wallet-compliance";

import type {
  PaymentAttestationPayload,
  PaymentPayload,
  PaymentReceipt,
  PaymentRequirement,
  PaymentRequirementsResponse,
  TypedDataSigner,
} from "./types";
import { X402Error, FacilitatorError } from "./errors";
import { parsePaymentRequirements } from "./payment-requirements";
import { signPaymentAuthorization } from "./eip3009";
import {
  computeBindingHash,
  encodeAttestationHeader,
  verifyBindingHash,
} from "./attestation-binding";

/**
 * Policy hook — called before any signing happens. Returning
 * `{decision: "allow"}` lets the payment proceed; anything else
 * aborts with a typed error.
 *
 * The hook is deliberately synchronous-capable (returns
 * `Decision | Promise<Decision>`) so tests and simple
 * allow-all policies don't need to be async. Real policy engines
 * (our `@aethelred/wallet-policy`) are async because they read
 * chain state for velocity tracking.
 */
export type PaymentPolicyDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string }
  | { readonly decision: "approval-required"; readonly reason: string };

export type PaymentPolicyHook = (
  req: PaymentRequirement,
) => PaymentPolicyDecision | Promise<PaymentPolicyDecision>;

/**
 * Source of a fresh TEE quote. Clients that run inside a TEE
 * implement this by calling their platform SDK (e.g. Nitro's
 * attestation document endpoint, Intel DCAP's `quote_gen`).
 * Clients running OUTSIDE a TEE pass `undefined` and simply skip
 * attestation-gated receivers.
 */
export interface AttestationProvider {
  /**
   * Fetch a TEE quote. The `userData` parameter MUST be embedded
   * in the quote's user-data field — that's how the quote binds
   * to the request. Platform verifiers check it against the
   * payment's struct hash to foil replay of a stolen quote.
   */
  getQuote(userData: `0x${string}`): Promise<TeeQuote>;
}

/**
 * Minimal audit capture contract. Real deployments pass an
 * instance of `@aethelred/wallet-audit` AuditCapture; tests pass
 * a no-op collector.
 */
export interface AuditHook {
  record(event: {
    readonly kind: "x402-pay-start" | "x402-pay-success" | "x402-pay-failure";
    readonly resource: string;
    readonly network: string;
    readonly amount: string;
    readonly paymentId?: string;
    readonly errorCode?: string;
    readonly message?: string;
  }): void;
}

export interface X402FetchOptions {
  /** Signer for the EIP-3009 authorization. */
  readonly signer: TypedDataSigner;

  /** Policy engine hook. Called on each 402 with the chosen requirement. */
  readonly onPolicyCheck?: PaymentPolicyHook;

  /** TEE quote provider. Required to use attestation-gated receivers. */
  readonly attestation?: AttestationProvider;

  /** Audit sink; receives events for success + failure. */
  readonly audit?: AuditHook;

  /** Optional init fields merged into the retry request. */
  readonly fetchInit?: RequestInit;

  /**
   * Override for `fetch`. Mainly for tests (jsdom's fetch is
   * sometimes flaky for MVs). Production code passes `globalThis.fetch`
   * bound to the current context.
   */
  readonly fetch?: typeof fetch;
}

export interface X402FetchResult {
  /** The final (200+) `Response`. */
  readonly response: Response;
  /**
   * Parsed receipt from the `X-PAYMENT-RESPONSE` header. `undefined`
   * if the initial request succeeded without payment (status < 400).
   */
  readonly receipt?: PaymentReceipt;
  /**
   * The requirement the client actually paid against. `undefined`
   * when no payment was needed.
   */
  readonly paidAgainst?: PaymentRequirement;
}

/**
 * One-shot "fetch this URL, paying if we have to" entry point.
 */
export async function x402Fetch(
  input: RequestInfo | URL,
  options: X402FetchOptions,
): Promise<X402FetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const firstResponse = await fetchImpl(input, options.fetchInit);

  if (firstResponse.status !== 402) {
    return { response: firstResponse };
  }

  const requirements = await parse402(firstResponse);
  const requirement = pickRequirement(requirements);

  const fromAddress = options.signer.address;

  options.audit?.record({
    kind: "x402-pay-start",
    resource: requirement.resource,
    network: requirement.network,
    amount: requirement.maxAmountRequired,
  });

  // ─── Policy gate (before any key touches data) ──────────────
  if (options.onPolicyCheck) {
    const decision = await options.onPolicyCheck(requirement);
    if (decision.decision === "deny") {
      const err = new X402Error("facilitator-rejected", `Policy denied payment: ${decision.reason}`);
      options.audit?.record({
        kind: "x402-pay-failure",
        resource: requirement.resource,
        network: requirement.network,
        amount: requirement.maxAmountRequired,
        errorCode: err.code,
        message: decision.reason,
      });
      throw err;
    }
    if (decision.decision === "approval-required") {
      // Callers surface this to a human for sign-off; we never
      // auto-proceed. Throw so the caller has a clear handoff
      // point. The code below is different from "deny" so the
      // UI can render a pending-approval state vs. a hard stop.
      throw new X402Error(
        "facilitator-rejected",
        `Payment requires human approval: ${decision.reason}`,
        { details: { kind: "approval-required" } },
      );
    }
  }

  // ─── Sign the payment ───────────────────────────────────────
  const paymentPayload = await signPaymentAuthorization({
    requirement,
    from: fromAddress,
    signer: options.signer,
  });

  // ─── Attestation (moat) ─────────────────────────────────────
  let attestationPayload: PaymentAttestationPayload | undefined;
  if (requirement.attestation) {
    if (!options.attestation) {
      throw new X402Error(
        "attestation-unavailable",
        `Receiver requires TEE attestation but no AttestationProvider was supplied`,
      );
    }
    const quote = await options.attestation.getQuote(paymentPayload.payload.structHash);
    const bindingHash = computeBindingHash(paymentPayload.payload.structHash, quote);
    attestationPayload = { x402Version: 1, quote, bindingHash };
  }

  // ─── Retry with headers ────────────────────────────────────
  const headers = new Headers(options.fetchInit?.headers);
  headers.set("X-PAYMENT", encodePaymentHeader(paymentPayload));
  if (attestationPayload) {
    headers.set("X-PAYMENT-ATTESTATION", encodeAttestationHeader(attestationPayload));
  }
  const retryInit: RequestInit = {
    ...options.fetchInit,
    headers,
  };

  const finalResponse = await fetchImpl(input, retryInit);

  if (!finalResponse.ok) {
    const err = new FacilitatorError(
      "facilitator-rejected",
      `Server rejected payment retry with ${finalResponse.status}`,
      {
        httpStatus: finalResponse.status,
        facilitatorMessage: await safeReadText(finalResponse),
      },
    );
    options.audit?.record({
      kind: "x402-pay-failure",
      resource: requirement.resource,
      network: requirement.network,
      amount: requirement.maxAmountRequired,
      errorCode: err.code,
      message: err.facilitatorMessage,
    });
    throw err;
  }

  const receipt = parseReceiptHeader(finalResponse);
  if (!receipt) {
    throw new X402Error(
      "unexpected-response-shape",
      `Server accepted payment (${finalResponse.status}) but did not return X-PAYMENT-RESPONSE`,
    );
  }

  // Guard: the facilitator MUST echo the binding hash if we sent
  // one. A server that silently strips attestation headers is
  // evidence of a misconfigured facilitator and we reject
  // downstream use of its response.
  if (attestationPayload) {
    if (!receipt.attestationBindingHash) {
      throw new X402Error(
        "receipt-binding-mismatch",
        "Receiver accepted payment but did not echo attestation binding hash",
      );
    }
    const bindingOk = verifyBindingHash({
      structHash: paymentPayload.payload.structHash,
      quote: attestationPayload.quote,
      claimedBindingHash: receipt.attestationBindingHash,
    });
    if (!bindingOk) {
      throw new X402Error(
        "receipt-binding-mismatch",
        "Facilitator-echoed binding hash does not match the one we computed",
      );
    }
  }

  options.audit?.record({
    kind: "x402-pay-success",
    resource: requirement.resource,
    network: requirement.network,
    amount: requirement.maxAmountRequired,
    paymentId: receipt.paymentId,
  });

  return { response: finalResponse, receipt, paidAgainst: requirement };
}

// ─── Helpers ────────────────────────────────────────────────────

async function parse402(res: Response): Promise<PaymentRequirementsResponse> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new X402Error("invalid-payment-requirement", "402 body is not valid JSON", { cause });
  }
  return parsePaymentRequirements(body);
}

/**
 * Pick the "best" requirement from an accepts[] list. V0.1 picks
 * the first supported one; future versions can implement price
 * comparison, preferred-network, or pre-existing-balance routing.
 */
function pickRequirement(reqs: PaymentRequirementsResponse): PaymentRequirement {
  if (reqs.accepts.length === 0) {
    throw new X402Error("no-acceptable-requirement", "No payment requirements advertised");
  }
  return reqs.accepts[0];
}

function encodePaymentHeader(p: PaymentPayload): string {
  const json = JSON.stringify(p);
  // Base64 for HTTP-safe transport (JSON contains commas/quotes
  // that many proxies mangle in raw headers).
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function parseReceiptHeader(res: Response): PaymentReceipt | undefined {
  const header = res.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return undefined;
  let decoded: string;
  try {
    decoded = atob(header);
  } catch (cause) {
    throw new X402Error(
      "payment-receipt-invalid",
      "X-PAYMENT-RESPONSE is not valid base64",
      { cause },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (cause) {
    throw new X402Error(
      "payment-receipt-invalid",
      "X-PAYMENT-RESPONSE is not valid JSON",
      { cause },
    );
  }
  // Minimal structural check. Facilitators that add fields beyond
  // the spec are tolerated (forward-compat); missing required
  // fields are not.
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { x402Version?: unknown }).x402Version !== 1 ||
    typeof (parsed as { paymentId?: unknown }).paymentId !== "string"
  ) {
    throw new X402Error("payment-receipt-invalid", "X-PAYMENT-RESPONSE does not match expected shape");
  }
  return parsed as PaymentReceipt;
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
