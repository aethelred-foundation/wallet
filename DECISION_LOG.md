# Aethelred Wallet Decision Log

Status: Local working log

## DEC-001

Date: 2026-04-10
Decision: Start with a browser extension shell before mobile.
Reason:

- fastest route to provider integration
- best surface for first-party dApp compatibility
- easiest way to validate connect, approve, sign, and audit loops early

## DEC-002

Date: 2026-04-10
Decision: Build one local npm workspace with `apps/*` and `packages/*`.
Reason:

- keeps UI and provider contracts separate
- lets the team move fast without locking the final repo topology too early
- supports incremental replacement of mock components

## DEC-003

Date: 2026-04-10
Decision: Treat `Aethelred Connect` as an adapter layer, not the wallet core.
Reason:

- compatibility matters, but it is not the moat
- core differentiation belongs in trust, policy, approvals, identity, and audit

## DEC-004

Date: 2026-04-10
Decision: Keep Personal, Enterprise, and Sovereign as one product core with different assurance modes.
Reason:

- avoids separate wallet products
- keeps institutional features foundational instead of bolted on later

## DEC-005

Date: 2026-04-10
Decision: Use a demo kernel first to prove request and approval flow before wiring real signing.
Reason:

- lets product, design, and engineering align on the request lifecycle early
- reduces throwaway UI work
