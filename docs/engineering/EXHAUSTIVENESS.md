# Exhaustiveness checking

**Status:** adopted (April 2026).
**Owner:** Cruzible / Platform.
**Primary module:** [`packages/observability/src/never.ts`](../../packages/observability/src/never.ts).

## Why this pattern matters

TypeScript's strongest correctness guarantee — discriminated unions — is
only as safe as the `switch` statements that consume them. The language
does **not** force you to handle every variant of a union unless your
`default` arm narrows the scrutinee down to `never`. That narrowing only
happens when the arm calls a function whose parameter type is `never`.

Without this pattern:

```ts
type TxStatus = "pending" | "confirmed" | "failed";

function badge(status: TxStatus): string {
  switch (status) {
    case "pending":   return "yellow";
    case "confirmed": return "green";
    // BUG: "failed" silently drops through.
  }
  return "gray"; // silent swallow
}
```

A reviewer would catch the missing `"failed"` case today. But the union
will grow — `"expired"`, `"cancelled"`, `"replaced"` — and the next
change will not lie in this file, or in a file the author knows to
read. Every consumer of the union becomes a candidate for a silent
regression:

- Dispatchers mishandle new message kinds and hang the caller.
- Badge renderers fall through to "Unknown" and confuse the user.
- Policy engines default to `"deny"` (or worse, `"allow"`) because the
  new rule kind did not match any existing arm.
- Encoders skip unknown OTLP span kinds and corrupt downstream traces.

Exhaustiveness checks **convert those silent regressions into compile
errors**. The `never`-narrowing trick is the only TypeScript feature
that does this — everything else (ESLint rules, runtime assertions,
code review) is best-effort.

## How the pattern works

```ts
import { assertNever } from "@aethelred/wallet-observability";

function badge(status: TxStatus): string {
  switch (status) {
    case "pending":   return "yellow";
    case "confirmed": return "green";
    case "failed":    return "red";
    default:
      return assertNever(status, "badge");
  }
}
```

If the author later adds `"expired"` to the `TxStatus` union, the
compiler immediately rejects the call site:

```
error TS2345: Argument of type '"expired"' is not assignable to
parameter of type 'never'.
```

That diagnostic points at every consumer that missed the new variant —
nothing gets past review because nothing builds.

At runtime `assertNever` throws an `ExhaustivenessError`. That is a
safety net for values that escape the type system (JSON decoded into a
typed variable, postMessage payloads, localStorage reads). It should
never fire on the common path.

## Three helpers

The module exports three primitives. Pick based on the call-site's
failure semantics, not personal preference.

### `assertNever(x, context?)` — throw

Use for **critical paths** where a miss is worse than a crash:

- Message dispatch (`apps/extension/src/background.ts`).
- Policy evaluation (`packages/policy/src/engine.ts`).
- Credential verification (`packages/credentials/src/verifier.ts`).
- Cryptographic schema validation (`packages/credentials/src/payloads.ts`).
- Quorum evaluation (`packages/approval/src/workflow-engine.ts`).

The thrown `ExhaustivenessError` carries the offending value and the
optional `context` string for attribution, so SRE can trace the miss
back to the call site without a core dump.

### `warnNever(x, context, logger)` — log + degrade

Use for **non-critical paths** where degrading gracefully is safer than
throwing:

- UX label maps (badge text, status icons, risk colors).
- Telemetry tag emitters — missing tags are annoying, not dangerous.
- Developer-tools introspectors.

The helper writes a `warn`-level log record with code
`exhaustiveness.miss` and returns `undefined`. Callers typically pair
it with a sensible fallback:

```ts
function badgeColor(status: Status, log: Logger): string {
  switch (status) {
    case "ok":   return "green";
    case "warn": return "amber";
    case "bad":  return "red";
    default:
      warnNever(status, "badgeColor", log);
      return "gray";
  }
}
```

### `match(value, cases)` — exhaustive matcher

Use when every arm **returns a value**. The `cases` record is typed as
`Record<K, () => R>`, so the compiler demands a handler for every
variant of `K`:

```ts
const label = match(tier, {
  personal:   () => "Personal",
  workspace:  () => "Workspace",
  enterprise: () => "Enterprise",
  sovereign:  () => "Sovereign",
});
```

Prefer `match()` over `switch + assertNever` when arms are one-liners
and have no side effects. The former reads more cleanly; the latter is
better when arms destructure state or fire effects.

## When NOT to use assertNever

Do not convert switches where the scrutinee is **not** a closed
discriminated union:

- A JSON-RPC method string (`args.method: string`).
- A selector byte-sequence (`selector: string`).
- A WebAuthn `DOMException` name (`err.name: string`).
- A user-provided `filter` string coming from URL params before
  validation.

Adding `assertNever` to those switches is counterproductive — the union
is open by definition and the `default` arm is the correct fallback.
Document the openness if it is subtle.

## Review checklist for union changes

Whenever a PR adds a new variant to a discriminated union, the author
and reviewer run this checklist:

1. **Build-break survey.** Run `npm run type-check`. Every consumer
   that missed the new variant now fails. Fix in the same PR — never
   ship half-wired unions.
2. **Audit switches that predate the pattern.** If a switch on the
   affected union exists that is **not** yet calling `assertNever`,
   add the pattern in the same PR. This is the only way to close the
   gap monotonically.
3. **Update tests.** The sweep-lock tests in
   `apps/extension/src/test/exhaustiveness.test.ts` enumerate each
   union's members. Extend the list; the stable length assertion in
   the test will flag the change.
4. **Consider `warnNever` at the edges.** For UX-only surfaces, it may
   be correct to warn rather than throw. Make this choice explicit in
   the PR description.
5. **Never `as never` to silence the compiler.** If TypeScript refuses
   a cast at an `assertNever` site, the right fix is to add a real
   handler, not to paper over the diagnostic.

## Reference sites

Representative migrations from the April 2026 sweep:

- **Message dispatch** — `apps/extension/src/background.ts::handleMessage`.
- **Approval detail rendering** — `apps/extension/src/popup/views/approvals.tsx::DetailBody`.
- **Quorum evaluator** — `packages/approval/src/workflow-engine.ts::evaluateQuorum`.
- **Policy condition evaluator** — `packages/policy/src/engine.ts::matchesCondition`.
- **Credential predicate evaluator** — `packages/credentials/src/verifier.ts::evaluatePredicate`.
- **Bitcoin network lookup** — `packages/chain-btc/src/networks.ts::getNetworkParams`.
- **Compliance velocity metric** — `packages/compliance/src/velocity-monitor.ts::recordTransaction`.
- **OTLP span kind encoder** — `packages/observability/src/tracing.ts::kindToOtlp`.
- **Haptic / sound button effects** — `apps/extension/src/popup/components/micro/PressableButton.tsx`.

The full test coverage lives in
`apps/extension/src/test/exhaustiveness.test.ts`.

## FAQ

### Why not an ESLint rule?

ESLint's no-fallthrough-cases-in-switch rule catches obvious misses
but cannot infer variants added after the switch was written. The
`never`-narrowing trick **is** the check — it uses the compiler's
own inference, so it never drifts.

### Does this cost anything at runtime?

No. TypeScript narrows the scrutinee to `never` by the time control
reaches the default arm, so the branch is dead on the common path. The
thrown exception path only fires when an untyped value escapes the
type system.

### What about switches with intentional fallthrough?

`noFallthroughCasesInSwitch: true` is on in `tsconfig.base.json`, so
unlabeled fallthrough already fails to compile. Intentional fallthrough
between `case` bodies (no `break` / `return`) still compiles; call
`assertNever` in the final arm as usual.

### Why is `packages/observability` the home?

Every package in the monorepo already depends on observability for
logging, tracing, and errors. Placing `assertNever` here avoids
creating a new "utility" package that would become a catchall. The
module itself has zero runtime dependencies.
