import type { AppCatalogEntry } from "@aethelred/wallet-connect";

const DEVELOPMENT_PREVIEW_CATALOG: readonly AppCatalogEntry[] = import.meta.env.PROD ? [] : [
  {
    id: "cruzible",
    name: "Cruzible",
    category: "treasury",
    trustLevel: "first-party",
    readiness: "live",
    integrationMode: "evm",
    summary: "Liquid staking vault with TEE-verified validators.",
  },
  {
    id: "zeroid",
    name: "ZeroID",
    category: "identity",
    trustLevel: "first-party",
    readiness: "planned",
    integrationMode: "evm",
    summary: "Self-sovereign identity with recovery and delegation.",
  },
  {
    id: "terraqura",
    name: "TerraQura",
    category: "carbon",
    trustLevel: "first-party",
    readiness: "design",
    integrationMode: "evm",
    summary: "M-of-N multisig for carbon credit governance.",
  },
  {
    id: "shiora",
    name: "Shiora",
    category: "health",
    trustLevel: "first-party",
    readiness: "design",
    integrationMode: "compatibility",
    summary: "Privacy-preserving health data with consent management.",
  },
  {
    id: "noblepay",
    name: "NoblePay",
    category: "payments",
    trustLevel: "first-party",
    readiness: "design",
    integrationMode: "evm",
    summary: "Compliance-gated cross-border payments.",
  },
];

/**
 * Static catalog entries are prototypes, not authoritative deployment data.
 * Production therefore fails closed until catalog metadata comes from a
 * verified registry. Development builds may retain the previews for design
 * work without leaking their readiness claims into a release wallet state.
 */
export function getWalletAppCatalog(
  isProductionBuild: boolean = import.meta.env.PROD,
): AppCatalogEntry[] {
  if (import.meta.env.PROD || isProductionBuild) return [];
  return DEVELOPMENT_PREVIEW_CATALOG.map((entry) => ({ ...entry }));
}
