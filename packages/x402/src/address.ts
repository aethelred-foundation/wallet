/**
 * Address validation helpers.
 *
 * The wallet uses the `0x${string}` branded-template-literal pattern
 * for addresses everywhere. This file provides the one-shot runtime
 * validator that turns a `string` into a validated `Address` — the
 * ONLY sanctioned way to cross that boundary from untrusted input
 * (network, user text, JSON).
 *
 * We deliberately DO NOT EIP-55 checksum-validate here: checksum is a
 * display-layer convention, not a security property (EIP-55 exists
 * to catch typos in human-transcribed addresses; it offers zero
 * defense against a hostile counterparty). Facilitators and signers
 * must tolerate lowercase addresses.
 */

import type { Address } from "./types";
import { X402Error } from "./errors";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parse + validate a user-supplied string as an Ethereum address.
 *
 * Throws {@link X402Error} with code `invalid-payment-requirement`
 * if the shape is wrong; this is the canonical code used across the
 * client.ts / facilitator.ts layer for malformed wire data.
 */
export function asAddress(raw: unknown, field = "address"): Address {
  if (typeof raw !== "string" || !ADDRESS_RE.test(raw)) {
    throw new X402Error(
      "invalid-payment-requirement",
      `Field "${field}" is not a valid Ethereum address`,
      { details: { received: typeof raw === "string" ? raw.slice(0, 12) + "…" : typeof raw } },
    );
  }
  return raw.toLowerCase() as Address;
}

/**
 * Runtime predicate — returns `false` instead of throwing. Useful
 * in discriminated-union narrowers where throwing would be the wrong
 * ergonomics.
 */
export function isAddress(raw: unknown): raw is Address {
  return typeof raw === "string" && ADDRESS_RE.test(raw);
}
