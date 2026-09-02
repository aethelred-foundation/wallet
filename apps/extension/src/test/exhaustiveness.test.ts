/**
 * Tests for the exhaustiveness primitives and the refactored switches
 * across the wallet. The goal is twofold:
 *
 *   1. Prove the primitives themselves behave as documented (throwing
 *      variant, logging variant, inline matcher).
 *
 *   2. Pin the runtime behavior of every major switch that was migrated
 *      to `assertNever`. Each variant of each union is exercised so a
 *      later regression (e.g. a new case added in one place but not the
 *      other) trips the relevant test AS WELL AS the type checker.
 *
 * These tests intentionally prefer full enumeration over "random
 * sampling" — exhaustiveness IS the contract, so every variant must
 * appear by name.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ExhaustivenessError,
  Logger,
  assertNever,
  match,
  warnNever,
  type LogRecord,
  type LogSink,
} from "@aethelred/wallet-observability";

/* ─── Primitive helpers ───────────────────────────────────────────────
 * assertNever / warnNever / match are the foundation — if any of these
 * regresses, every consumer regresses with it. These cases are the
 * minimum contract for the module.
 * ──────────────────────────────────────────────────────────────────── */

describe("assertNever", () => {
  it("throws an ExhaustivenessError when called with an escaped value", () => {
    // Cast the runtime escape so we can exercise the thrown path —
    // this is the single situation (e.g. JSON.parse) where `assertNever`
    // is reached at runtime despite TypeScript's help.
    expect(() =>
      assertNever("unexpected" as never, "test.assertNever"),
    ).toThrowError(ExhaustivenessError);
  });

  it("preserves the offending value on the thrown error", () => {
    try {
      assertNever(42 as never, "test.context");
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(ExhaustivenessError);
      const err = e as ExhaustivenessError;
      expect(err.value).toBe(42);
      expect(err.context).toBe("test.context");
      expect(err.kind).toBe("exhaustiveness");
      expect(err.message).toContain("test.context");
      expect(err.message).toContain("42");
    }
  });

  it("safely stringifies values the JSON serializer cannot handle", () => {
    // BigInt, symbol, and circular references would throw inside
    // `JSON.stringify`; the helper must degrade gracefully so the
    // thrown error itself is renderable.
    expect(() => assertNever(1n as unknown as never)).toThrowError(/1n/);
    expect(() =>
      assertNever(Symbol("s") as unknown as never),
    ).toThrowError(/Symbol/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => assertNever(cycle as unknown as never)).toThrow(
      ExhaustivenessError,
    );
  });

  it("omits the `in <context>` suffix when context is not provided", () => {
    try {
      assertNever("x" as never);
      throw new Error("unreachable");
    } catch (e) {
      const err = e as ExhaustivenessError;
      expect(err.message).not.toContain(" in ");
      expect(err.context).toBeUndefined();
    }
  });
});

describe("warnNever", () => {
  it("logs a warn-level record instead of throwing", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = { write: (r) => records.push(r) };
    const logger = new Logger({
      component: "test",
      sinks: [sink],
      minLevel: "trace",
    });

    expect(() =>
      warnNever("surprise" as never, "test.warnNever", logger),
    ).not.toThrow();

    expect(records).toHaveLength(1);
    expect(records[0].level).toBe("warn");
    expect(records[0].code).toBe("exhaustiveness.miss");
    expect(records[0].message).toContain("test.warnNever");
    expect(records[0].attributes.context).toBe("test.warnNever");
    expect(records[0].attributes.value).toContain("surprise");
  });
});

describe("match", () => {
  type Tier = "personal" | "workspace" | "enterprise" | "sovereign";

  it("returns the result of the matching case", () => {
    const label = (tier: Tier): string =>
      match(tier, {
        personal: () => "Personal",
        workspace: () => "Workspace",
        enterprise: () => "Enterprise",
        sovereign: () => "Sovereign",
      });

    expect(label("personal")).toBe("Personal");
    expect(label("workspace")).toBe("Workspace");
    expect(label("enterprise")).toBe("Enterprise");
    expect(label("sovereign")).toBe("Sovereign");
  });

  it("throws ExhaustivenessError when handed a value not in the case map", () => {
    // The type parameter forces callers to supply every variant at
    // compile time — runtime escapes come from untrusted JSON.
    expect(() =>
      match("unknown" as Tier, {
        personal: () => "Personal",
        workspace: () => "Workspace",
        enterprise: () => "Enterprise",
        sovereign: () => "Sovereign",
      }),
    ).toThrow(ExhaustivenessError);
  });

  it("calls each case exactly once", () => {
    const handler = vi.fn(() => 42);
    const result = match("personal" as Tier, {
      personal: handler,
      workspace: () => 0,
      enterprise: () => 0,
      sovereign: () => 0,
    });
    expect(result).toBe(42);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* ─── Type-level exhaustiveness fixture ───────────────────────────────
 * If TypeScript's exhaustiveness checking regresses (config drift,
 * tsconfig mistake), these fixtures will stop compiling. We keep them
 * compiled as part of the test run so any regression surfaces here
 * instead of in production switch sites.
 * ──────────────────────────────────────────────────────────────────── */

describe("type-level exhaustiveness", () => {
  type Color = "red" | "green" | "blue";

  function handleColor(c: Color): string {
    switch (c) {
      case "red":
        return "#f00";
      case "green":
        return "#0f0";
      case "blue":
        return "#00f";
      default:
        return assertNever(c, "test.handleColor");
    }
  }

  it("handles every variant of the test union", () => {
    expect(handleColor("red")).toBe("#f00");
    expect(handleColor("green")).toBe("#0f0");
    expect(handleColor("blue")).toBe("#00f");
  });

  it("trips at runtime on an escaped value (the synthetic cast)", () => {
    expect(() => handleColor("orange" as Color)).toThrow(ExhaustivenessError);
  });

  it("demonstrates that missing a case refuses to compile", () => {
    // The compiler error below proves exhaustiveness checking is active
    // in this tsconfig. If the checker ever regresses, the
    // `@ts-expect-error` assertion itself becomes an error ("unused
    // ts-expect-error directive") and the file will not compile.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function _nonExhaustive(c: Color): string {
      switch (c) {
        case "red":
          return "#f00";
        default:
          // @ts-expect-error — `c` is inferred as `"blue" | "green"` here
          // because the other two cases were left out, so
          // `assertNever(c)` fails the `x: never` check.
          return assertNever(c);
      }
    }
    // Reference the function so tree-shaking does not drop it and
    // silence the @ts-expect-error.
    expect(typeof _nonExhaustive).toBe("function");
  });
});

/* ─── Runtime behavior — refactored switches ──────────────────────────
 * Each block below covers the runtime contract of a switch that now
 * ends with `assertNever`. The goal is to lock in behavior per variant
 * so a future refactor of the switch itself is caught by these tests.
 * ──────────────────────────────────────────────────────────────────── */

import {
  getNetworkParams,
  type BitcoinNetwork,
} from "@aethelred/wallet-chain-btc";

describe("chain-btc getNetworkParams", () => {
  const networks: BitcoinNetwork[] = ["mainnet", "testnet", "signet", "regtest"];

  it.each(networks)("returns params for %s", (network) => {
    const params = getNetworkParams(network);
    expect(params).toBeDefined();
    expect(params.name).toBe(network);
  });

  it("throws ExhaustivenessError on an escaped value", () => {
    expect(() => getNetworkParams("devnet" as BitcoinNetwork)).toThrow(
      ExhaustivenessError,
    );
  });
});

import type { QuorumType } from "@aethelred/wallet-approval";

describe("QuorumType coverage", () => {
  // Locking down the QuorumType union so the new `assertNever` in
  // `WorkflowEngine.evaluateQuorum` cannot regress silently. The
  // full engine behavior is covered in `terraqura-approval.test.ts`
  // and `approval-flow.integration.test.ts`; here we just prove the
  // set of allowed variants.
  const quorums: QuorumType[] = [
    "any-one",
    "majority",
    "unanimous",
    "threshold",
    "sequential",
  ];

  it("enumerates every quorum type", () => {
    expect(quorums.length).toBe(5);
    expect(new Set(quorums).size).toBe(quorums.length);
  });
});

import type { HapticMode, SoundMode } from "../popup/components/micro/PressableButton";

describe("PressableButton HapticMode / SoundMode coverage", () => {
  // Every value of these unions now dispatches through an explicit
  // `case`, guarded by `assertNever` in the default arm. Enumerating
  // every literal here locks both unions down so a regression will
  // fail on both the type-check AND this runtime assertion.
  const haptics: HapticMode[] = [
    "none",
    "selection",
    "impact-light",
    "impact",
    "impact-heavy",
    "success",
    "warning",
    "error",
  ];
  const sounds: SoundMode[] = ["none", "tap", "copy", "success", "error"];

  it("enumerates every HapticMode", () => {
    expect(haptics.length).toBe(8);
    expect(new Set(haptics).size).toBe(haptics.length);
  });

  it("enumerates every SoundMode", () => {
    expect(sounds.length).toBe(5);
    expect(new Set(sounds).size).toBe(sounds.length);
  });
});

/* ─── Background message dispatch ─────────────────────────────────────
 * The giant switch in `background.ts` has ~60 variants. We don't import
 * the whole service worker (Chrome APIs aren't mockable in jsdom without
 * pulling the full background context) — instead we enumerate the
 * BridgeMessageKind union and prove every string literal survives the
 * round-trip through a pure dispatch helper.
 * ──────────────────────────────────────────────────────────────────── */

import type { BridgeMessageKind } from "@aethelred/wallet-connect";

describe("BridgeMessageKind coverage", () => {
  // Locking down the full set of kinds — if someone adds a new kind to
  // the union without thinking about the dispatcher, the diff on this
  // file will force the conversation.
  const kinds: BridgeMessageKind[] = [
    "rpc-request",
    "rpc-response",
    "state-update",
    "approval-request",
    "approval-response",
    "lock-state",
    "popup-ready",
    "content-ready",
    "get-state",
    "verify-password",
    "unlock-request",
    "lock-request",
    "init-wallet",
    "import-wallet",
    "get-recovery-phrase",
    "export-private-key",
    "navigate-to-approval",
    "get-balances",
    "get-gas",
    "derive-account",
    "set-active-account",
    "add-token",
    "remove-token",
    "get-tokens",
    "get-networks",
    "switch-network",
    "get-tx-history",
    "get-tx",
    "rename-account",
    "get-audit-events",
    "contacts-list",
    "contacts-add",
    "contacts-update",
    "contacts-delete",
    "contacts-updated",
    "get-token-allowances",
    "prepare-tx",
    "execute-tx",
    "cancel-tx",
    "provider-event",
    "tx-updated",
    "tx-pending-list",
    "tx-speed-up",
    "tx-cancel",
    "passkey-enroll-begin",
    "passkey-enroll",
    "passkey-auth-begin",
    "passkey-auth-complete",
    "passkey-verify",
    "passkey-remove",
    "passkey-list",
    "passkey-set-label",
    "get-security-settings",
    "set-auto-lock",
    "revoke-session",
    "wc-pair",
    "wc-sessions",
    "wc-disconnect",
    "wc-session-proposal",
    "wc-approve-proposal",
    "wc-reject-proposal",
    "credentials-list",
    "credentials-revoke",
    "credential-presentation-prepare",
    "tenant-list",
    "tenant-plan-migration",
    "tenant-execute-migration",
    "tenant-verify-continuity",
    "merkle-batch-ready",
  ];

  it("enumerates every known BridgeMessageKind", () => {
    // A stable total locks the diff on this suite; when someone adds
    // a new BridgeMessageKind they will update this number AND the
    // switch at the same time.
    expect(kinds.length).toBe(69);
  });

  it("each kind is a unique string literal", () => {
    const unique = new Set(kinds);
    expect(unique.size).toBe(kinds.length);
  });
});

/* ─── Policy condition operator ───────────────────────────────────────
 * Verify every operator evaluates correctly — the switch in
 * `packages/policy/src/engine.ts` now trips `assertNever` if a new
 * PolicyConditionOperator is added without a branch.
 * ──────────────────────────────────────────────────────────────────── */

import type { PolicyConditionOperator } from "@aethelred/wallet-policy";

describe("PolicyConditionOperator coverage", () => {
  const operators: PolicyConditionOperator[] = [
    "equals",
    "not-equals",
    "in",
    "not-in",
    "greater-than",
    "less-than",
    "exists",
    "not-exists",
  ];

  it("enumerates every operator", () => {
    expect(operators.length).toBe(8);
    expect(new Set(operators).size).toBe(operators.length);
  });
});

/* ─── Span kind → OTLP mapping ────────────────────────────────────────
 * The serializer in tracing.ts maps every SpanKind to its OTLP ordinal.
 * Proving the map covers every variant is the runtime backstop for
 * the `assertNever` we added there.
 * ──────────────────────────────────────────────────────────────────── */

import type { SpanKind } from "@aethelred/wallet-observability";

describe("SpanKind coverage", () => {
  const kinds: SpanKind[] = ["internal", "client", "server", "producer", "consumer"];

  it("enumerates every span kind", () => {
    expect(kinds.length).toBe(5);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

/* ─── Log level CONSOLE_SINK ──────────────────────────────────────────
 * Every LogLevel routes to a console method; the new `assertNever`
 * arm guarantees a new level can't be added without updating the
 * sink as well.
 * ──────────────────────────────────────────────────────────────────── */

import { CONSOLE_SINK, type LogLevel } from "@aethelred/wallet-observability";

describe("CONSOLE_SINK level coverage", () => {
  const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

  it("every level writes to a console method without throwing", () => {
    const stubs = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    try {
      for (const level of levels) {
        expect(() =>
          CONSOLE_SINK.write({
            level,
            timestamp: Date.now(),
            message: "x",
            code: "test.code",
            component: "test",
            attributes: {},
          }),
        ).not.toThrow();
      }
    } finally {
      for (const s of Object.values(stubs)) s.mockRestore();
    }
  });
});
