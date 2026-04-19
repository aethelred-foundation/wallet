export type FirstPartyContractTrust =
  | "trusted"
  | "unrecognized"
  | "unpinned"
  | "not-applicable";

export interface TrustedContractEntry<TContractId extends string = string> {
  id: TContractId;
  label: string;
  addresses: string[];
}

export interface FirstPartyContractAssessment {
  contractTrust: FirstPartyContractTrust;
  targetContractAddress?: string;
  targetContractLabel?: string;
  expectedContractLabels: string[];
  trustWarning?: string;
}

export function assessFirstPartyContractTrust<TContractId extends string>(input: {
  appName: string;
  actionLabel: string;
  targetAddress: string | null | undefined;
  expectedContracts: Array<TrustedContractEntry<TContractId>>;
}): FirstPartyContractAssessment {
  const expectedContractLabels = input.expectedContracts.map((contract) => contract.label);
  const targetContractAddress = normalizeAddress(input.targetAddress);
  const pinnedContracts = input.expectedContracts.filter((contract) => contract.addresses.length > 0);

  if (pinnedContracts.length === 0) {
    return {
      contractTrust: "unpinned",
      targetContractAddress,
      expectedContractLabels,
      trustWarning: buildUnpinnedDeploymentWarning(
        input.appName,
        input.actionLabel,
        expectedContractLabels,
      ),
    };
  }

  const trustedContract = targetContractAddress
    ? pinnedContracts.find((contract) =>
        contract.addresses.some((address) => normalizeAddress(address) === targetContractAddress),
      )
    : undefined;

  if (trustedContract) {
    return {
      contractTrust: "trusted",
      targetContractAddress,
      targetContractLabel: trustedContract.label,
      expectedContractLabels,
    };
  }

  return {
    contractTrust: "unrecognized",
    targetContractAddress,
    expectedContractLabels,
    trustWarning: buildUnrecognizedContractWarning(
      input.appName,
      input.actionLabel,
      input.targetAddress,
      expectedContractLabels,
    ),
  };
}

export function normalizeAddress(value: string | null | undefined): string | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return undefined;
  }

  return value.toLowerCase();
}

function buildUnrecognizedContractWarning(
  appName: string,
  actionLabel: string,
  targetAddress: string | null | undefined,
  expectedContractLabels: string[],
): string {
  const expected = expectedContractLabels.length > 0
    ? expectedContractLabels.join(" or ")
    : "a pinned contract";
  const target = targetAddress ?? "the target contract";

  return `This calldata matches ${appName}'s ${actionLabel.toLowerCase()} flow, but ${target} is not in the wallet's trusted ${appName} registry for ${expected}.`;
}

function buildUnpinnedDeploymentWarning(
  appName: string,
  actionLabel: string,
  expectedContractLabels: string[],
): string {
  const expected = expectedContractLabels.length > 0
    ? expectedContractLabels.join(" or ")
    : "this flow";

  return `${appName}'s ${actionLabel.toLowerCase()} flow expects ${expected}, but the wallet does not have a pinned deployment address for it yet. Review this transaction as an unverified contract interaction until the deployment is registered.`;
}
