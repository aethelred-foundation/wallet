# Cross-Platform Parity Contract

The Aethelred Wallet ships three first-party runtime surfaces — the
Chrome extension (TypeScript), the iOS app (Swift), and the Android
app (Kotlin) — that must agree **bit-for-bit** on the crypto
primitives used for audit, attestation, and signing. Drift between
any two platforms would break off-chain verifiers and the evidence
chain.

This document lists the test vectors that all three platforms
assert against. The same values are hard-coded in:

- `apps/extension/src/test/contract/cross-platform.test.ts`
- `apps/ios/AethelredWalletTests/SemanticParityTest.swift`
- `apps/android/app/src/androidTest/java/org/aethelred/SemanticParityTest.kt`

If you change a vector, update all three files AND bump
`CONTRACT_VERSION` in the TypeScript test.

## Shared vectors

### keccak256("hello world")

```
47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad
```

### keccak256("")

```
c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
```

### Audit-event canonical hash

Input form:

```
seqNumber | timestamp | kind | JSON.stringify(detail) | previousHash
```

Separator is ASCII `|`. `JSON.stringify` uses default key order —
the TypeScript implementation is the canonical reference. Every
platform serializes `detail` with the same canonicalization (sorted
keys, no whitespace).

### Merkle root over 5 leaves

Leaves hash `"parity-leaf-1"` through `"parity-leaf-5"` via
`sha256(utf8)`. The Merkle tree uses the duplicate-last-odd rule
from BIP141. The resulting root is a pure function of the leaves;
any drift in leaf hashing, pairing order, or root construction
breaks the equality across platforms.

## Triangle testing rationale

Three platforms × one shared vector = if any two disagree the test
fails in at least two places:

- TS disagrees with iOS → TS test passes, iOS test fails.
- iOS disagrees with Android → iOS test passes, Android test fails.
- TS disagrees with both → TS contract test fails.

This structure means no single-platform edit can silently break
the invariant without breaking a visible test elsewhere.

## Change protocol

1. Propose the change in an RFC. Include the reason (e.g. we are
   migrating the canonical detail serializer to sorted-keys-only).
2. Update all three test files in one PR. Set `CONTRACT_VERSION`
   to the next integer in the TS test.
3. Get approval from two owners of each platform (TS / iOS /
   Android).
4. After merge, publish the `CONTRACT_VERSION` bump to the
   off-chain verifier team — they pin the version they expect.
