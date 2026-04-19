import type { TrustedContractEntry } from "./first-party-contract-trust";

/**
 * TerraQura deployment registry — trusted contract addresses.
 *
 * ─── WHY THIS MODULE EXISTS ─────────────────────────────────────
 * When a user signs a transaction against TerraQura, the wallet
 * checks whether the `to` address matches a known TerraQura contract
 * (proxy or historical implementation). If it does, the approval
 * screen shows product-aware copy ("Approve TerraQura marketplace
 * purchase") instead of the generic "Confirm transaction" fallback.
 *
 * The registry also drives the first-party contract trust check
 * surfaced to the workflow engine + audit log — an address that
 * looks like a marketplace call but ISN'T on our pinned list gets
 * flagged as "calldata matches TerraQura's flow but target is not
 * in the trusted registry."
 *
 * ─── WHY THE ADDRESSES ARE INLINED ──────────────────────────────
 * Earlier revisions of this file imported JSON manifests from a
 * sibling repository (`dApps/terraqura/apps/contracts/deployments/`).
 * That coupling broke once the wallet was extracted into its own
 * repo — the JSON files simply aren't reachable from here.
 *
 * Until we ship a proper runtime resolver that fetches the active
 * deployment manifest from the TerraQura control-plane API (or an
 * on-chain registry), we inline the known Polygon Amoy addresses
 * below. The addresses come from the TerraQura deployment artifacts
 * tracked in the dApps repo; update this file whenever a new proxy
 * upgrade ships so historical implementations stay recognized.
 *
 * Future migration path:
 *   1. Add a fetch-on-startup flow that pulls the manifest from
 *      a signed endpoint (e.g. `https://terraqura.io/.well-known/
 *      deployments.json`) and caches it in chrome.storage
 *   2. Fall back to this inlined registry when offline
 *   3. Retire the inline addresses once the fetch path ships
 * ────────────────────────────────────────────────────────────── */

export type TerraQuraContractId =
  | "carbon-marketplace"
  | "gasless-marketplace"
  | "carbon-credit"
  | "carbon-retirement";

export const TERRAQURA_CONTRACT_REGISTRY: Record<
  TerraQuraContractId,
  TrustedContractEntry<TerraQuraContractId>
> = {
  "carbon-marketplace": {
    id: "carbon-marketplace",
    label: "CarbonMarketplace",
    /* Polygon Amoy — TransparentUpgradeableProxy + current
     * implementation. Both addresses are accepted so a user can sign
     * against either the proxy (typical path) or the raw
     * implementation (admin path) and the wallet still recognizes it. */
    addresses: [
      "0x35c46526B0c17bD893C2d29D428e90ef194F1Ab7",
      "0x85b13A91e1DE82a6eE628dc17865bfAED01a49de",
    ],
  },
  "gasless-marketplace": {
    id: "gasless-marketplace",
    label: "GaslessMarketplace",
    /* No Polygon Amoy deployment pinned yet. When TerraQura deploys
     * the gasless marketplace, append the proxy + implementation
     * here (and ideally wire the runtime fetcher described above). */
    addresses: [],
  },
  "carbon-credit": {
    id: "carbon-credit",
    label: "CarbonCredit",
    addresses: ["0x29B58064fD95b175e5824767d3B18bACFafaF959"],
  },
  "carbon-retirement": {
    id: "carbon-retirement",
    label: "CarbonRetirement",
    /* The wallet intentionally has no pinned CarbonRetirement
     * address yet — the approval flow surfaces this as a warning so
     * the user is aware their retirement transaction is going to a
     * contract that isn't in the trusted registry. */
    addresses: [],
  },
};
