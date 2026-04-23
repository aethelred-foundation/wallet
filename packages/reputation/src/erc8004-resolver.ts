/**
 * ERC-8004 resolver implementations.
 *
 * Two shipping implementations:
 *
 *   - `InMemoryERC8004Resolver` — for tests, dev, and deterministic
 *     integration harnesses. Takes a pre-populated map of agents.
 *
 *   - `CachingERC8004Resolver` — wraps any inner resolver with a
 *     bounded LRU + TTL. Production deployments compose this around
 *     their viem/ethers-backed on-chain resolver so the hot path
 *     doesn't hit chain RPC on every gate evaluation.
 *
 * The real on-chain resolver lives OUT of this package — we do not
 * take a hard dep on viem or ethers so consumers that ship a browser
 * extension can avoid the bundle hit. Production callers wire a
 * small shim into the `ERC8004Resolver` contract (see README).
 */

import type { AgentIdentity, ERC8004Resolver } from "./types";
import { ReputationError } from "./errors";

/**
 * Simple in-memory resolver backed by two maps (control-address →
 * agent, agent-id → attestation-uids). Suitable for unit tests and
 * local-dev; NOT suitable for anything that needs live ERC-8004
 * registry data.
 */
export class InMemoryERC8004Resolver implements ERC8004Resolver {
  private readonly byControlAddress = new Map<string, AgentIdentity>();
  private readonly byAgentId = new Map<string, AgentIdentity>();
  private readonly attestationUids = new Map<string, ReadonlyArray<`0x${string}`>>();

  constructor(
    seed: ReadonlyArray<{
      readonly identity: AgentIdentity;
      readonly attestationUids?: ReadonlyArray<`0x${string}`>;
    }> = [],
  ) {
    for (const entry of seed) {
      this.register(entry.identity, entry.attestationUids ?? []);
    }
  }

  /**
   * Register (or overwrite) an agent identity. Exposed publicly so
   * tests and fixtures can evolve the registry mid-run — NOT used by
   * production paths.
   */
  register(identity: AgentIdentity, attestationUids: ReadonlyArray<`0x${string}`>): void {
    this.byControlAddress.set(identity.controlAddress.toLowerCase(), identity);
    this.byAgentId.set(identity.agentId.toLowerCase(), identity);
    this.attestationUids.set(identity.agentId.toLowerCase(), [...attestationUids]);
  }

  async resolveByControlAddress(controlAddress: `0x${string}`): Promise<AgentIdentity | null> {
    return this.byControlAddress.get(controlAddress.toLowerCase()) ?? null;
  }

  async resolveByAgentId(agentId: `0x${string}`): Promise<AgentIdentity | null> {
    return this.byAgentId.get(agentId.toLowerCase()) ?? null;
  }

  async listAttestationUids(agentId: `0x${string}`): Promise<ReadonlyArray<`0x${string}`>> {
    return this.attestationUids.get(agentId.toLowerCase()) ?? [];
  }

  async isRevoked(agentId: `0x${string}`): Promise<boolean> {
    const id = this.byAgentId.get(agentId.toLowerCase());
    if (!id) {
      throw new ReputationError(
        "agent-not-registered",
        `Agent ${agentId} not registered in InMemoryERC8004Resolver`,
      );
    }
    return id.revoked;
  }
}

// ─── Caching wrapper ────────────────────────────────────────────

/**
 * Snapshot an LRU entry carries. We cache the resolved identity AND
 * the attestation-uid list under the same agent-id key; the flag
 * `revokedAt` captures a late-bound revocation so callers that hit
 * the cache after a revocation still see the latest truth (TTL is
 * short anyway).
 */
interface CacheEntry {
  identity: AgentIdentity | null;
  attestationUids?: ReadonlyArray<`0x${string}`>;
  expiresAt: number;
}

export interface CachingERC8004ResolverConfig {
  /** TTL per entry, in ms. Default: 30_000 (30 seconds). */
  readonly ttlMs?: number;
  /** Max entries before LRU eviction. Default: 512. */
  readonly maxEntries?: number;
  /** Pluggable clock for tests. Default: `() => Date.now()`. */
  readonly now?: () => number;
}

export class CachingERC8004Resolver implements ERC8004Resolver {
  private readonly inner: ERC8004Resolver;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  // Two caches because the two lookup keys have different identities.
  // The attestation cache piggybacks on the agent-id cache so we don't
  // double-evict.
  private readonly byControl = new Map<string, CacheEntry>();
  private readonly byAgentId = new Map<string, CacheEntry>();

  constructor(inner: ERC8004Resolver, config: CachingERC8004ResolverConfig = {}) {
    this.inner = inner;
    this.ttlMs = config.ttlMs ?? 30_000;
    this.maxEntries = config.maxEntries ?? 512;
    this.now = config.now ?? (() => Date.now());
  }

  async resolveByControlAddress(controlAddress: `0x${string}`): Promise<AgentIdentity | null> {
    const key = controlAddress.toLowerCase();
    const hit = this.byControl.get(key);
    if (hit && hit.expiresAt > this.now()) {
      // Refresh LRU position.
      this.byControl.delete(key);
      this.byControl.set(key, hit);
      return hit.identity;
    }
    const identity = await this.inner.resolveByControlAddress(controlAddress);
    this.store(this.byControl, key, { identity, expiresAt: this.now() + this.ttlMs });
    if (identity) {
      // Mirror into the agent-id cache so a subsequent `resolveByAgentId`
      // or `isRevoked` call hits.
      this.store(this.byAgentId, identity.agentId.toLowerCase(), {
        identity,
        expiresAt: this.now() + this.ttlMs,
      });
    }
    return identity;
  }

  async resolveByAgentId(agentId: `0x${string}`): Promise<AgentIdentity | null> {
    const key = agentId.toLowerCase();
    const hit = this.byAgentId.get(key);
    if (hit && hit.expiresAt > this.now()) {
      this.byAgentId.delete(key);
      this.byAgentId.set(key, hit);
      return hit.identity;
    }
    const identity = await this.inner.resolveByAgentId(agentId);
    this.store(this.byAgentId, key, { identity, expiresAt: this.now() + this.ttlMs });
    return identity;
  }

  async listAttestationUids(agentId: `0x${string}`): Promise<ReadonlyArray<`0x${string}`>> {
    const key = agentId.toLowerCase();
    const hit = this.byAgentId.get(key);
    if (hit && hit.attestationUids && hit.expiresAt > this.now()) {
      return hit.attestationUids;
    }
    const uids = await this.inner.listAttestationUids(agentId);
    // Attach to the entry if we have one; otherwise skip — the next
    // `resolve*` call will create the entry properly.
    if (hit) {
      hit.attestationUids = uids;
    }
    return uids;
  }

  async isRevoked(agentId: `0x${string}`): Promise<boolean> {
    // Always bypass cache for revocation — revocations are rare but
    // they're safety-critical. Callers that want cached revocations
    // check `resolveByAgentId(...).revoked` themselves.
    return this.inner.isRevoked(agentId);
  }

  /** Drop every cache entry. Exposed for ops tools. */
  clear(): void {
    this.byControl.clear();
    this.byAgentId.clear();
  }

  // ─── Private ────────────────────────────────────────────────

  private store(cache: Map<string, CacheEntry>, key: string, entry: CacheEntry): void {
    cache.delete(key); // refresh LRU position
    cache.set(key, entry);
    while (cache.size > this.maxEntries) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
  }
}
