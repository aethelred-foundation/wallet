import type { AppIdentity, ApprovalDetail } from "@aethelred/wallet-connect";
import {
  assessFirstPartyContractTrust,
  type FirstPartyContractTrust,
} from "./first-party-contract-trust";
import {
  TERRAQURA_CONTRACT_REGISTRY,
  type TerraQuraContractId,
} from "./terraqura-deployments";

type TxApprovalDetail = Extract<ApprovalDetail, { kind: "tx" }>;
type TxApprovalMode = "send" | "sign";

interface ApprovalPresentationInput {
  app: AppIdentity;
  mode: TxApprovalMode;
  detail: TxApprovalDetail;
  defaultTitle: string;
  defaultSummary: string;
}

interface ApprovalPresentation {
  title: string;
  summary: string;
  detail: TxApprovalDetail;
}

interface TerraQuraActionDescriptor {
  decodedMethod: string;
  title: string;
  signingTitle?: string;
  summary: string;
  signingSummary?: string;
  allowedContracts: TerraQuraContractId[];
  warnings: string[];
  decodeParams: (detail: TxApprovalDetail) => Record<string, string> | undefined;
}

export interface TerraQuraTransactionAssessment {
  matchedSelector: boolean;
  selector?: string;
  actionLabel?: string;
  contractTrust: FirstPartyContractTrust;
  targetContractAddress?: string;
  targetContractLabel?: string;
  expectedContractLabels: string[];
  trustWarning?: string;
}

const TERRAQURA_SELECTORS: Record<string, TerraQuraActionDescriptor> = {
  "0xfdb3d7c5": {
    decodedMethod: "Marketplace listing",
    title: "Approve TerraQura marketplace listing",
    signingTitle: "Sign TerraQura marketplace listing",
    summary: "TerraQura wants to escrow carbon credits into the marketplace and create a listing.",
    signingSummary: "TerraQura wants the wallet to sign a marketplace listing transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "This listing escrows the selected carbon credits into TerraQura's marketplace contract until they are sold or cancelled.",
    ],
    decodeParams: (detail) => {
      const data = detail.data;
      return {
        "Credit token ID": decodeUintParam(data, 0),
        "Credit amount": decodeUintParam(data, 1),
        "Price per credit (wei)": decodeUintParam(data, 2),
        "Minimum purchase amount": decodeUintParam(data, 3),
        "Listing duration (seconds)": decodeUintParam(data, 4),
      };
    },
  },
  "0x305a67a8": {
    decodedMethod: "Cancel marketplace listing",
    title: "Approve TerraQura listing cancellation",
    signingTitle: "Sign TerraQura listing cancellation",
    summary: "TerraQura wants to cancel a marketplace listing and return the escrowed credits.",
    signingSummary: "TerraQura wants the wallet to sign a listing cancellation transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "Cancelling a listing should return the remaining escrowed credits from the marketplace contract.",
    ],
    decodeParams: (detail) => ({
      "Listing ID": decodeUintParam(detail.data, 0),
    }),
  },
  "0x70876c98": {
    decodedMethod: "Marketplace purchase",
    title: "Approve TerraQura marketplace purchase",
    signingTitle: "Sign TerraQura marketplace purchase",
    summary: "TerraQura wants to complete a carbon credit purchase on the marketplace.",
    signingSummary: "TerraQura wants the wallet to sign a marketplace purchase transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "This purchase moves payment and carbon credits on-chain. TerraQura marketplace actions may also require active KYC status.",
    ],
    decodeParams: (detail) => ({
      "Listing ID": decodeUintParam(detail.data, 0),
      "Credit amount": decodeUintParam(detail.data, 1),
      "Payment attached (wei)": hexToDecimalString(detail.value),
    }),
  },
  "0x3a97f852": {
    decodedMethod: "Marketplace offer",
    title: "Approve TerraQura marketplace offer",
    signingTitle: "Sign TerraQura marketplace offer",
    summary: "TerraQura wants to lock funds and create a purchase offer for carbon credits.",
    signingSummary: "TerraQura wants the wallet to sign a marketplace offer transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "Creating an offer locks the attached deposit in the TerraQura marketplace until the offer is accepted or cancelled.",
    ],
    decodeParams: (detail) => ({
      "Credit token ID": decodeUintParam(detail.data, 0),
      "Credit amount": decodeUintParam(detail.data, 1),
      "Offer price per credit (wei)": decodeUintParam(detail.data, 2),
      "Offer duration (seconds)": decodeUintParam(detail.data, 3),
      "Deposit attached (wei)": hexToDecimalString(detail.value),
    }),
  },
  "0xef706adf": {
    decodedMethod: "Cancel marketplace offer",
    title: "Approve TerraQura offer cancellation",
    signingTitle: "Sign TerraQura offer cancellation",
    summary: "TerraQura wants to cancel a marketplace offer and release the locked deposit.",
    signingSummary: "TerraQura wants the wallet to sign an offer cancellation transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "Cancelling an offer should return the remaining locked deposit from the TerraQura marketplace contract.",
    ],
    decodeParams: (detail) => ({
      "Offer ID": decodeUintParam(detail.data, 0),
    }),
  },
  "0xc815729d": {
    decodedMethod: "Accept marketplace offer",
    title: "Approve TerraQura offer acceptance",
    signingTitle: "Sign TerraQura offer acceptance",
    summary: "TerraQura wants to accept an existing marketplace offer and transfer the selected carbon credits.",
    signingSummary: "TerraQura wants the wallet to sign an offer acceptance transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-marketplace", "gasless-marketplace"],
    warnings: [
      "Accepting an offer transfers your carbon credits and settles the buyer's locked payment.",
    ],
    decodeParams: (detail) => ({
      "Offer ID": decodeUintParam(detail.data, 0),
    }),
  },
  "0xc081ec96": {
    decodedMethod: "Carbon retirement",
    title: "Approve TerraQura carbon retirement",
    signingTitle: "Sign TerraQura carbon retirement",
    summary: "TerraQura wants to permanently retire carbon credits from your balance.",
    signingSummary: "TerraQura wants the wallet to sign a carbon retirement transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-credit"],
    warnings: [
      "Carbon retirement is intended to be permanent and usually burns the retired credits.",
    ],
    decodeParams: (detail) => ({
      "Credit token ID": decodeUintParam(detail.data, 0),
      "Retirement amount": decodeUintParam(detail.data, 1),
      Reason: decodeStringParam(detail.data, 2),
    }),
  },
  "0x31963830": {
    decodedMethod: "Batch carbon retirement",
    title: "Approve TerraQura batch retirement",
    signingTitle: "Sign TerraQura batch retirement",
    summary: "TerraQura wants to permanently retire multiple carbon credit positions in one transaction.",
    signingSummary: "TerraQura wants the wallet to sign a batch carbon retirement transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-credit"],
    warnings: [
      "Batch retirement is intended to be permanent and may burn multiple carbon credit positions at once.",
    ],
    decodeParams: (detail) => {
      const tokenIds = decodeUintArrayParam(detail.data, 0);
      const amounts = decodeUintArrayParam(detail.data, 1);

      return {
        "Retirement count": String(tokenIds.length),
        "Credit token IDs": tokenIds.join(", "),
        "Retirement amounts": amounts.join(", "),
        Reason: decodeStringParam(detail.data, 2),
      };
    },
  },
  "0xfcbb5043": {
    decodedMethod: "Retirement certificate",
    title: "Approve TerraQura retirement record",
    signingTitle: "Sign TerraQura retirement record",
    summary: "TerraQura wants to retire carbon credits and record a beneficiary-linked retirement certificate.",
    signingSummary: "TerraQura wants the wallet to sign a retirement record transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-retirement"],
    warnings: [
      "This retirement is intended to be permanent and creates a beneficiary-linked retirement record.",
    ],
    decodeParams: (detail) => ({
      "Credit token ID": decodeUintParam(detail.data, 0),
      "Retirement amount": decodeUintParam(detail.data, 1),
      Beneficiary: decodeStringParam(detail.data, 2),
      Reason: decodeStringParam(detail.data, 3),
    }),
  },
  "0xc6915646": {
    decodedMethod: "Batch retirement certificate",
    title: "Approve TerraQura batch retirement record",
    signingTitle: "Sign TerraQura batch retirement record",
    summary: "TerraQura wants to retire multiple carbon credit positions and record them under one beneficiary.",
    signingSummary: "TerraQura wants the wallet to sign a batch retirement record transaction. The wallet will NOT broadcast it.",
    allowedContracts: ["carbon-retirement"],
    warnings: [
      "This batch retirement is intended to be permanent and creates beneficiary-linked retirement records.",
    ],
    decodeParams: (detail) => {
      const tokenIds = decodeUintArrayParam(detail.data, 0);
      const amounts = decodeUintArrayParam(detail.data, 1);

      return {
        "Retirement count": String(tokenIds.length),
        "Credit token IDs": tokenIds.join(", "),
        "Retirement amounts": amounts.join(", "),
        Beneficiary: decodeStringParam(detail.data, 2),
        Reason: decodeStringParam(detail.data, 3),
      };
    },
  },
};

export function applyTerraQuraApprovalPresentation(
  input: ApprovalPresentationInput,
): ApprovalPresentation {
  if (input.app.id !== "terraqura") {
    return {
      title: input.defaultTitle,
      summary: input.defaultSummary,
      detail: input.detail,
    };
  }

  const assessment = inspectTerraQuraTransaction(input.app, input.detail);
  if (!assessment.matchedSelector || !assessment.selector) {
    return {
      title: input.defaultTitle,
      summary: input.defaultSummary,
      detail: input.detail,
    };
  }

  if (assessment.contractTrust !== "trusted") {
    return {
      title: input.defaultTitle,
      summary: input.defaultSummary,
      detail: {
        ...input.detail,
        warnings: assessment.trustWarning
          ? dedupeWarnings([...input.detail.warnings, assessment.trustWarning])
          : input.detail.warnings,
      },
    };
  }

  const descriptor = TERRAQURA_SELECTORS[assessment.selector];
  const warnings = dedupeWarnings([...input.detail.warnings, ...descriptor.warnings]);
  const decodedParams = safeDecodeParams(descriptor, input.detail);

  return {
    title: input.mode === "sign" ? (descriptor.signingTitle ?? descriptor.title) : descriptor.title,
    summary: input.mode === "sign" ? (descriptor.signingSummary ?? descriptor.summary) : descriptor.summary,
    detail: {
      ...input.detail,
      warnings,
      decodedMethod: descriptor.decodedMethod,
      decodedParams: withTrustedContractLabel(decodedParams, assessment.targetContractLabel),
    },
  };
}

export function inspectTerraQuraTransaction(
  app: AppIdentity,
  detail: TxApprovalDetail,
): TerraQuraTransactionAssessment {
  if (app.id !== "terraqura") {
    return {
      matchedSelector: false,
      contractTrust: "not-applicable",
      expectedContractLabels: [],
    };
  }

  const selector = getSelector(detail.data);
  if (!selector) {
    return {
      matchedSelector: false,
      contractTrust: "not-applicable",
      expectedContractLabels: [],
    };
  }

  const descriptor = TERRAQURA_SELECTORS[selector];
  if (!descriptor) {
    return {
      matchedSelector: false,
      selector,
      contractTrust: "not-applicable",
      expectedContractLabels: [],
    };
  }

  const expectedContracts = descriptor.allowedContracts
    .map((contractId) => TERRAQURA_CONTRACT_REGISTRY[contractId])
    .filter(Boolean);
  const trustAssessment = assessFirstPartyContractTrust({
    appName: app.name,
    actionLabel: descriptor.decodedMethod,
    targetAddress: detail.to,
    expectedContracts,
  });

  return {
    matchedSelector: true,
    selector,
    actionLabel: descriptor.decodedMethod,
    ...trustAssessment,
  };
}

function dedupeWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings.filter(Boolean)));
}

function withTrustedContractLabel(
  decodedParams: Record<string, string> | undefined,
  trustedContractLabel: string | undefined,
): Record<string, string> | undefined {
  if (!trustedContractLabel) {
    return decodedParams;
  }

  return {
    "TerraQura contract": trustedContractLabel,
    ...(decodedParams ?? {}),
  };
}

function safeDecodeParams(
  descriptor: TerraQuraActionDescriptor,
  detail: TxApprovalDetail,
): Record<string, string> | undefined {
  try {
    return descriptor.decodeParams(detail);
  } catch {
    return detail.decodedParams;
  }
}

function getSelector(data: string): string | null {
  if (!isHex(data) || data.length < 10) {
    return null;
  }

  return data.slice(0, 10).toLowerCase();
}

function decodeUintParam(data: string, index: number): string {
  const args = stripSelector(data);
  const word = readWord(args, index * 32);
  return BigInt(`0x${word}`).toString(10);
}

function decodeStringParam(data: string, index: number): string {
  const args = stripSelector(data);
  const offset = Number(BigInt(`0x${readWord(args, index * 32)}`));
  const length = Number(BigInt(`0x${readWord(args, offset)}`));
  const start = (offset + 32) * 2;
  const end = start + (length * 2);
  return new TextDecoder().decode(hexToBytes(args.slice(start, end)));
}

function decodeUintArrayParam(data: string, index: number): string[] {
  const args = stripSelector(data);
  const offset = Number(BigInt(`0x${readWord(args, index * 32)}`));
  const length = Number(BigInt(`0x${readWord(args, offset)}`));
  const values: string[] = [];

  for (let position = 0; position < length; position += 1) {
    const itemOffset = offset + 32 + (position * 32);
    values.push(BigInt(`0x${readWord(args, itemOffset)}`).toString(10));
  }

  return values;
}

function stripSelector(data: string): string {
  if (!isHex(data) || data.length < 10) {
    throw new Error("Invalid calldata");
  }

  return data.slice(10);
}

function readWord(argsWithoutSelector: string, byteOffset: number): string {
  const start = byteOffset * 2;
  const end = start + 64;
  const word = argsWithoutSelector.slice(start, end);

  if (word.length !== 64) {
    throw new Error("Calldata word out of bounds");
  }

  return word;
}

function isHex(value: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(value);
}

function hexToDecimalString(hexValue: string): string {
  if (!hexValue || !isHex(hexValue)) {
    return "0";
  }

  return BigInt(hexValue).toString(10);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = hex.slice(index * 2, (index * 2) + 2);
    bytes[index] = Number.parseInt(byte, 16);
  }

  return bytes;
}
