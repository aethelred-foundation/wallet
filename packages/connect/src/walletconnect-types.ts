/**
 * WalletConnect v2 protocol surface — type-level foundation.
 *
 * This module captures the minimum TypeScript contract the wallet needs
 * to interoperate with the WalletConnect v2 / Sign API protocol without
 * depending on the `@walletconnect/*` SDK at this layer. The goal is
 * to keep `@aethelred/wallet-connect` zero-runtime-dependency so that
 * the inpage provider, content bridge, background service worker, and
 * popup can all import these shapes without dragging a multi-megabyte
 * SDK into every bundle.
 *
 * Only the session-proposal, session, and session-request shapes that
 * actually cross the extension bridge are modelled here. Relayer,
 * pairing internals, and CAIP-25 edge cases that the SDK hides behind
 * its own abstractions are intentionally out of scope.
 *
 * References:
 *   - WalletConnect v2 Sign API: https://docs.walletconnect.com/2.0/specs/
 *   - CAIP-2 (chain identifier): https://chainagnostic.org/CAIPs/caip-2
 *   - CAIP-10 (account identifier): https://chainagnostic.org/CAIPs/caip-10
 *   - EIP-155 namespace registration: https://chainagnostic.org/CAIPs/caip-155
 */

/**
 * Metadata the dApp publishes about itself as part of a pairing /
 * session-proposal exchange. The wallet treats every field as
 * untrusted user input — the popup renders them but applies the
 * same XSS-safe escaping rules it uses for connected-site metadata.
 */
export interface WalletConnectPeerMetadata {
  /** Human-readable dApp name shown in the approval sheet. */
  name: string;
  /** Short description of what the dApp does. */
  description: string;
  /** Canonical origin URL. Used for same-origin trust checks. */
  url: string;
  /** Logo / icon URLs, ordered best-first. May be empty. */
  icons: string[];
}

/**
 * The CAIP-2 / CAIP-25 namespace block a dApp either requires or
 * optionally accepts. Under WalletConnect v2, `requiredNamespaces`
 * must be satisfied for the session to be created; `optionalNamespaces`
 * may be partially fulfilled or omitted entirely.
 */
export interface WalletConnectNamespaceRequirement {
  /**
   * Ordered list of CAIP-2 chain identifiers the dApp wants to use
   * (for example `"eip155:1"` or `"eip155:137"`). When the wallet
   * replies to a proposal it narrows this set down to the chains
   * it can actually serve.
   *
   * `chains` is optional on the required block because WalletConnect
   * allows proposers to send a chain-less namespace and rely on the
   * `methods` / `events` to constrain scope.
   */
  chains?: string[];
  /** RPC method identifiers — e.g. `"eth_sendTransaction"`. */
  methods: string[];
  /** Event identifiers — e.g. `"chainChanged"`, `"accountsChanged"`. */
  events: string[];
}

/**
 * The matching block that the wallet produces in response to a proposal.
 * Every approved namespace block MUST carry concrete CAIP-10 `accounts`
 * the wallet is willing to expose to the dApp.
 */
export interface WalletConnectApprovedNamespace {
  /**
   * Fully-qualified CAIP-10 account identifiers
   * (for example `"eip155:1:0xAbC…"`).
   */
  accounts: string[];
  /** Methods the wallet will respond to on this namespace. */
  methods: string[];
  /** Events the wallet will emit on this namespace. */
  events: string[];
  /** Optional chain list the wallet pins the session to. */
  chains?: string[];
}

/**
 * Session proposal emitted by the WalletConnect relay when a dApp
 * calls `web3wallet.pair()` and requests a session.
 *
 * This matches the shape that `@walletconnect/web3wallet`'s
 * `session_proposal` event hands to listeners, minus SDK-internal
 * bookkeeping (verify context, ephemeral relayer state) that the
 * wallet has no business persisting.
 */
export interface WalletConnectSessionProposal {
  /** Numeric proposal id — correlates approve / reject responses. */
  id: number;
  /** The pairing topic the proposal arrived on. */
  pairingTopic: string;
  /** The dApp that initiated the pairing. */
  proposer: {
    /** Ephemeral public key the relayer uses for this proposal. */
    publicKey: string;
    /** Metadata the dApp published in its `AppKit` / `Web3Modal` init. */
    metadata: WalletConnectPeerMetadata;
  };
  /** Namespaces the dApp requires — must ALL be satisfied to approve. */
  requiredNamespaces: Record<string, WalletConnectNamespaceRequirement>;
  /** Namespaces the dApp would like but can tolerate being dropped. */
  optionalNamespaces: Record<string, WalletConnectNamespaceRequirement>;
  /** Free-form session properties (EVM-specific, chain capabilities…). */
  sessionProperties?: Record<string, string>;
  /** Unix seconds — proposal auto-expires after this. */
  expiry: number;
}

/**
 * An approved, active WalletConnect v2 session. The wallet persists
 * these so the popup's Connected Sites list can manage them.
 */
export interface WalletConnectSession {
  /** Session topic — the stable identifier for this session. */
  topic: string;
  /** The peer (dApp) that the wallet is paired with. */
  peer: {
    publicKey: string;
    metadata: WalletConnectPeerMetadata;
  };
  /** Approved namespaces — what the dApp is actually allowed to do. */
  namespaces: Record<string, WalletConnectApprovedNamespace>;
  /** Unix seconds — session auto-expires here unless extended. */
  expiry: number;
  /**
   * Whether the peer has ack-ed the wallet's approval. Only fully
   * usable sessions are `true`; pending / in-flight ones are `false`.
   */
  acknowledged: boolean;
}

/**
 * An inbound JSON-RPC request that arrived over an active session.
 * The wallet MUST route these through the same policy / workflow /
 * approval pipeline as native EIP-1193 requests — WalletConnect is a
 * transport, not a policy bypass.
 */
export interface WalletConnectSessionRequest {
  /** Request id — echoed back on the response. */
  id: number;
  /** Session topic this request arrived on. */
  topic: string;
  /** Request payload, identical shape to JSON-RPC. */
  params: {
    request: {
      /** Method, for example `"eth_sendTransaction"`. */
      method: string;
      /** Untyped params array — validated per-method downstream. */
      params: unknown;
    };
    /** CAIP-2 chain id the dApp is requesting against. */
    chainId: string;
  };
}

/**
 * Branded `wc:` URI. The brand prevents raw strings from being
 * accepted by helpers that assume a validated URI.
 */
export type WalletConnectPairingUri = string & {
  readonly __brand: unique symbol;
};

/**
 * Regex for WalletConnect v2 pairing URIs.
 *
 * Canonical shape:
 *   `wc:<topic>@<version>?relay-protocol=<proto>&symKey=<hex>&…`
 *
 * `topic` is typically a hex string but the v2 spec only requires it
 * to be a URL-safe identifier — we accept any word characters plus
 * `-` and `.` so that synthetic topics used by SDK test harnesses and
 * some enterprise relayers still validate. `version` is an integer.
 * The regex is deliberately permissive on the query string because
 * relayers are free to add parameters (`expiryTimestamp`, `methods`,
 * etc.).
 */
const WALLETCONNECT_URI_REGEX = /^wc:[A-Za-z0-9._-]{1,256}@\d+(\?[^\s]+)?$/;

/**
 * Parse a string that may or may not be a WalletConnect v2 pairing URI.
 *
 * Returns the string branded as {@link WalletConnectPairingUri} on
 * success, or `null` if the input doesn't match the spec. This is
 * intentionally strict — rejecting malformed URIs here means every
 * downstream consumer can trust the shape.
 *
 * @example
 *   const parsed = parseWalletConnectUri(userInput);
 *   if (!parsed) {
 *     showError("That doesn't look like a WalletConnect link.");
 *     return;
 *   }
 *   await manager.pair(parsed);
 */
export function parseWalletConnectUri(raw: string): WalletConnectPairingUri | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith("wc:")) return null;
  if (!WALLETCONNECT_URI_REGEX.test(trimmed)) return null;
  // Additional sanity: must contain a symKey or relay-protocol parameter
  // to be a usable v2 URI. v1 URIs (no query string) cannot be paired
  // with a v2 wallet and should be rejected.
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex === -1) return null;
  const query = trimmed.slice(queryIndex + 1);
  if (!/symKey=/.test(query) && !/relay-protocol=/.test(query)) {
    return null;
  }
  return trimmed as WalletConnectPairingUri;
}

/**
 * Compose a CAIP-10 account identifier from an EIP-155 chain id and
 * an EVM address. Lower-cases the address to match the CAIP-10 spec's
 * canonical form (checksum casing is cosmetic, equality must be
 * case-insensitive).
 *
 * @param chainId - numeric EIP-155 chain id (1, 137, 42161, …)
 * @param address - 0x-prefixed 20-byte hex address
 * @returns a CAIP-10 identifier, e.g. `"eip155:1:0xabc..."`
 *
 * @example
 *   toCaip10Account(1, "0xAbCdEf...") // "eip155:1:0xabcdef..."
 */
export function toCaip10Account(chainId: number, address: string): string {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`invalid chainId: ${chainId}`);
  }
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`invalid EVM address: ${address}`);
  }
  return `eip155:${chainId}:${address.toLowerCase()}`;
}

/**
 * Extract the numeric chain id from a CAIP-2 identifier, ONLY for the
 * `eip155` namespace. Non-EVM namespaces (Solana, Cosmos, …) return
 * `null` because this wallet is EVM-only at this layer.
 *
 * @param caip2 - a CAIP-2 chain identifier, e.g. `"eip155:137"`
 * @returns the numeric chain id, or `null` if not EIP-155 or malformed
 *
 * @example
 *   fromCaip2ChainId("eip155:137")      // 137
 *   fromCaip2ChainId("solana:mainnet")  // null
 *   fromCaip2ChainId("bad-format")      // null
 */
export function fromCaip2ChainId(caip2: string): number | null {
  if (typeof caip2 !== "string") return null;
  const parts = caip2.split(":");
  if (parts.length !== 2) return null;
  const [namespace, reference] = parts;
  if (namespace !== "eip155") return null;
  if (!/^\d+$/.test(reference)) return null;
  const parsed = Number.parseInt(reference, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Compose a CAIP-2 chain identifier from a numeric EIP-155 chain id.
 *
 * @param chainId - numeric EIP-155 chain id
 * @returns a CAIP-2 identifier, e.g. `"eip155:1"`
 */
export function toCaip2ChainId(chainId: number): string {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`invalid chainId: ${chainId}`);
  }
  return `eip155:${chainId}`;
}

/**
 * Split a CAIP-10 account identifier into its `(chainId, address)`
 * components, returning `null` when the input isn't an EVM CAIP-10.
 *
 * @example
 *   fromCaip10Account("eip155:1:0xabc...")
 *   // { chainId: 1, address: "0xabc..." }
 */
export function fromCaip10Account(
  caip10: string,
): { chainId: number; address: string } | null {
  if (typeof caip10 !== "string") return null;
  const parts = caip10.split(":");
  if (parts.length !== 3) return null;
  const [namespace, reference, address] = parts;
  if (namespace !== "eip155") return null;
  if (!/^\d+$/.test(reference)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const chainId = Number.parseInt(reference, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  return { chainId, address: address.toLowerCase() };
}

/**
 * Standard WalletConnect v2 rejection reasons. The numeric codes
 * follow the JSON-RPC 2.0 error code conventions the WalletConnect
 * spec reuses.
 */
export const WALLETCONNECT_REJECTION = {
  USER_REJECTED: { code: 5000, message: "User rejected." },
  USER_REJECTED_CHAINS: { code: 5100, message: "User rejected chains." },
  USER_REJECTED_METHODS: { code: 5101, message: "User rejected methods." },
  USER_REJECTED_EVENTS: { code: 5102, message: "User rejected events." },
  UNSUPPORTED_CHAINS: { code: 5100, message: "Unsupported chains." },
  UNSUPPORTED_METHODS: { code: 5101, message: "Unsupported methods." },
  UNSUPPORTED_EVENTS: { code: 5102, message: "Unsupported events." },
  UNSUPPORTED_ACCOUNTS: { code: 5103, message: "Unsupported accounts." },
  UNSUPPORTED_NAMESPACE_KEY: {
    code: 5104,
    message: "Unsupported namespace key.",
  },
  USER_DISCONNECTED: { code: 6000, message: "User disconnected." },
  SESSION_SETTLEMENT_FAILED: {
    code: 7000,
    message: "Session settlement failed.",
  },
} as const;

/**
 * Convenience response shape the approval flow hands back to
 * {@link WalletConnectManager}. Mirrors the SDK's own accept / reject
 * discriminator so the wiring is a straight forward-pass.
 */
export type WalletConnectProposalDecision =
  | {
      approved: true;
      /** CAIP-10 accounts the wallet exposes on this session. */
      accounts: string[];
      /** Resolved per-namespace approval — keyed by namespace (e.g. "eip155"). */
      namespaces: Record<string, WalletConnectApprovedNamespace>;
    }
  | {
      approved: false;
      /** Optional rejection code — defaults to USER_REJECTED. */
      reason?: { code: number; message: string };
    };

/**
 * Response the policy engine hands back for a session request.
 */
export type WalletConnectRequestDecision =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };
