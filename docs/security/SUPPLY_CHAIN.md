# Aethelred Wallet — Supply-chain security

> **Scope.** Supply-chain controls for the Aethelred Wallet: SBOM
> strategy, SLSA provenance level targets, vulnerability-patching SLAs,
> and the release-artifact verification workflow that downstream
> consumers (enterprise customers, SOC-2 auditors, L1 treasury signers)
> should follow.

## 1. SBOM strategy

### 1.1 Format and tooling

- **Format.** CycloneDX 1.6 JSON. Chosen over SPDX because CycloneDX
  encodes component hashes and dependency-tree relationships directly
  in a single file, which downstream tools (Dependency-Track,
  Anchore, OWASP DependencyCheck) consume natively.
- **Generator.** `@cyclonedx/cyclonedx-npm` runs on every push to main
  and every release tag via `.github/workflows/sbom.yml`. The SBOM is
  uploaded as a workflow artifact and, on releases, attached to the
  GitHub Release as `sbom.json`.
- **Scope.** Today the SBOM covers the npm workspace (Chrome
  extension + packages). iOS and Android SBOMs are tracked as TODOs
  until those builds land in the monorepo; once they do, we will run
  `cdxgen` against Gradle (Android) and Swift Package Manager (iOS)
  and merge the outputs into a single per-release SBOM.

### 1.2 SBOM consumption contract

Enterprise customers integrating the wallet into their own build /
deploy pipelines are expected to:

1. Download `sbom.json` from the GitHub Release assets.
2. Validate the signature on the accompanying SLSA provenance file
   (see §3) to confirm the SBOM ships from a trusted build.
3. Feed `sbom.json` into their own SCA tooling (Dependency-Track,
   Snyk, Mend, etc.) to score the release against their vulnerability
   policy.
4. File a GitHub Security Advisory if the scoring reveals a finding
   Aethelred is not already tracking.

## 2. Signed releases and artifact naming

Every versioned release produces:

- `aethelred-wallet-vX.Y.Z.zip` — the deterministic extension bundle
  produced by `scripts/package-extension.mjs`.
- `sbom.json` — CycloneDX 1.6 SBOM for the versioned tree.
- `aethelred-wallet.intoto.jsonl` — SLSA v1.0 provenance attestation
  signed by GitHub's OIDC-issued Sigstore keypair.

Naming is stable across versions so automation in downstream CI can
pattern-match without per-release configuration.

## 3. SLSA provenance level targets

The wallet targets SLSA v1.0 Build levels:

| Track | Target today | Target 2026 end of year | Rationale |
|-------|--------------|-------------------------|-----------|
| **Build L1** (provenance exists) | Met | Met | Provenance attached to every release. |
| **Build L2** (hosted build, signed provenance) | **Met** (current state) | Met | GitHub-hosted runners + OIDC-signed Sigstore keypair. |
| **Build L3** (hardened builder, non-forgeable provenance) | In progress | **Target** | Requires runner-level isolation guarantees beyond what GitHub Actions attests today, plus reproducible-build verification baked into the workflow. Tracked in the phase-2 epic. |

Build L2 is already sufficient for SOC-2 CC6.8 and most enterprise
vendor-risk reviews. We aim for L3 before the wallet ships to
sovereign-tier customers.

## 4. Vulnerability patching SLAs

These SLAs apply to production dependencies of the shipped wallet
extension. devDependencies and build tooling are held to a best-
effort but not contracted SLA.

| Severity | Patch target | Trigger | Exception handling |
|----------|--------------|---------|--------------------|
| **Critical (CVSS ≥ 9.0)** | **< 7 days** from advisory publication, regardless of business hours | Dependabot critical PR, `npm audit --audit-level=critical` finding, or manual disclosure via `security@aethelred.org`. | If a patched release does not yet exist, file a temporary mitigation PR (e.g. runtime disablement of the vulnerable code path) within 48 hours. |
| **High (CVSS 7.0 – 8.9)** | **< 30 days** | Same triggers. | If the advisory is marked "not exploitable in our context" after review by CODEOWNERS, document the risk acceptance in `docs/security/` and proceed. |
| **Medium (CVSS 4.0 – 6.9)** | < 90 days | Same triggers. | Grouped into the next scheduled dependency-bump PR. |
| **Low (CVSS < 4.0)** | Next scheduled release | Weekly audit report. | Aggregated into a monthly hygiene PR. |

All patch PRs re-run the full CI suite, including the
`vulnerability-gate.yml` audit step, before merge.

## 5. Provenance verification workflow

Downstream consumers (and internal release managers) verify a release
with `slsa-verifier`:

```bash
slsa-verifier verify-artifact \
  --provenance-path aethelred-wallet.intoto.jsonl \
  --source-uri github.com/aethelred-foundation/wallet \
  --source-tag v1.2.3 \
  aethelred-wallet-v1.2.3.zip
```

The command succeeds iff:

1. The provenance was signed by the GitHub OIDC-issued Sigstore
   keypair.
2. The signed statement's subject digest matches the SHA-256 of the
   downloaded ZIP byte-for-byte.
3. The `source-uri` in the provenance matches the expected repo.
4. The `source-tag` matches the tag the consumer is pulling.

A verification failure MUST block the artifact from being loaded into
a production wallet installation.

## 6. Repository-level hardening controls

The following hardening controls run on every PR and every push:

- **CSP in the manifest** (`apps/extension/public/manifest.json`) —
  `script-src 'self'`, no `unsafe-eval`, no `unsafe-inline` for
  scripts, `connect-src` narrowed to declared host permissions.
- **CODEOWNERS** — security-critical paths require review from the
  owner.
- **OpenSSF Scorecard** — weekly, published to code scanning.
- **CodeQL** — matrix across JS + TS with the `security-extended`
  query pack, weekly.
- **Semgrep** — OWASP + JS + TS + supply-chain rulesets, plus
  `.semgrep/aethelred.yml` local ruleset for wallet-specific
  invariants.
- **TruffleHog** — every PR, full-history sweep weekly.
- **License scanner** — fails the build on GPL/AGPL/SSPL/LGPL in
  production dependencies.
- **Dependency vulnerability gate** — `npm audit --audit-level=high`
  fails merge on unresolved HIGH/CRITICAL production findings.

## 7. Revision log

| Date | Revision | Notes |
|------|----------|-------|
| 2026-04-19 | v1.0 | Initial supply-chain document. |
