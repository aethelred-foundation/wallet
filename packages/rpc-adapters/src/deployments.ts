/**
 * Deterministic deployment addresses for the Aethelred contracts.
 *
 * Pinned against `contracts/deployments.json`. Production deployments
 * using the same CREATE2 salt produce these exact addresses on every
 * chain that hosts the canonical CREATE2 deployer.
 */

export const DETERMINISTIC_ADDRESSES = Object.freeze({
  AgentBudget: "0x801D88B922f6B1BDD047EEfa0eE8e41dCDb694bC" as `0x${string}`,
  Notary: "0xaf9923CD404d3124C092E50A94327B2e56343370" as `0x${string}`,
});

export const DEPLOYMENT_SALT =
  "0xae2afe54a4e176bd4e65767beb247b7f61d320e637ab6231233853cef800373a" as const;

export const CREATE2_DEPLOYER =
  "0x4e59b44847b379578588920cA78FbF26c0B4956C" as `0x${string}`;
