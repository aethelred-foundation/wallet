import { describe, expect, it } from "vitest";
import type { AppIdentity, ApprovalDetail } from "@aethelred/wallet-connect";
import { applyTerraQuraApprovalPresentation, inspectTerraQuraTransaction } from "../lib/terraqura-approval";

const TERRAQURA_APP: AppIdentity = {
  id: "terraqura",
  name: "TerraQura",
  origin: "https://app.terraqura.io",
  trustLevel: "first-party",
};

const EXTERNAL_APP: AppIdentity = {
  id: "external",
  name: "External dApp",
  origin: "https://example.com",
  trustLevel: "unverified",
};

const TRUSTED_MARKETPLACE = "0x35c46526B0c17bD893C2d29D428e90ef194F1Ab7";
const CURRENT_MARKETPLACE_IMPLEMENTATION = "0x85b13A91e1DE82a6eE628dc17865bfAED01a49de";
const TRUSTED_CARBON_CREDIT = "0x29B58064fD95b175e5824767d3B18bACFafaF959";
const UNKNOWN_CONTRACT = "0x2222222222222222222222222222222222222222";

describe("applyTerraQuraApprovalPresentation", () => {
  it("leaves non-TerraQura approvals unchanged", () => {
    const detail = buildDetail("0xdeadbeef");
    const result = applyTerraQuraApprovalPresentation({
      app: EXTERNAL_APP,
      mode: "send",
      detail,
      defaultTitle: "Confirm transaction",
      defaultSummary: "External dApp is asking to send a transaction.",
    });

    expect(result.title).toBe("Confirm transaction");
    expect(result.summary).toBe("External dApp is asking to send a transaction.");
    expect(result.detail).toEqual(detail);
  });

  it("annotates TerraQura marketplace purchases with product-aware copy", () => {
    const detail = buildDetail(encodeUintArgs("0x70876c98", [42n, 7n]), {
      to: TRUSTED_MARKETPLACE,
      value: "0x2386f26fc10000",
      warnings: ["Base simulation warning"],
    });
    const result = applyTerraQuraApprovalPresentation({
      app: TERRAQURA_APP,
      mode: "send",
      detail,
      defaultTitle: "Confirm transaction",
      defaultSummary: "TerraQura is asking to send a transaction.",
    });

    expect(result.title).toBe("Approve TerraQura marketplace purchase");
    expect(result.summary).toContain("complete a carbon credit purchase");
    expect(result.detail.decodedMethod).toBe("Marketplace purchase");
    expect(result.detail.decodedParams).toEqual({
      "TerraQura contract": "CarbonMarketplace",
      "Listing ID": "42",
      "Credit amount": "7",
      "Payment attached (wei)": "10000000000000000",
    });
    expect(result.detail.warnings).toContain("Base simulation warning");
    expect(result.detail.warnings).toContain(
      "This purchase moves payment and carbon credits on-chain. TerraQura marketplace actions may also require active KYC status.",
    );
  });

  it("uses sign-specific copy for TerraQura marketplace offers", () => {
    const detail = buildDetail(encodeUintArgs("0x3a97f852", [11n, 3n, 25n, 86400n]), {
      to: TRUSTED_MARKETPLACE,
      value: "0x56bc75e2d63100000",
    });
    const result = applyTerraQuraApprovalPresentation({
      app: TERRAQURA_APP,
      mode: "sign",
      detail,
      defaultTitle: "Sign transaction (no broadcast)",
      defaultSummary: "TerraQura is asking to sign a transaction.",
    });

    expect(result.title).toBe("Sign TerraQura marketplace offer");
    expect(result.summary).toContain("wallet will NOT broadcast it");
    expect(result.detail.decodedMethod).toBe("Marketplace offer");
    expect(result.detail.decodedParams?.["TerraQura contract"]).toBe("CarbonMarketplace");
    expect(result.detail.decodedParams?.["Deposit attached (wei)"]).toBe("100000000000000000000");
  });

  it("trusts TerraQura's current v3 marketplace implementation from the deployment manifests", () => {
    const detail = buildDetail(encodeUintArgs("0x70876c98", [12n, 2n]), {
      to: CURRENT_MARKETPLACE_IMPLEMENTATION,
      value: "0xde0b6b3a7640000",
    });
    const assessment = inspectTerraQuraTransaction(TERRAQURA_APP, detail);

    expect(assessment.contractTrust).toBe("trusted");
    expect(assessment.targetContractLabel).toBe("CarbonMarketplace");
    expect(assessment.expectedContractLabels).toEqual(["CarbonMarketplace", "GaslessMarketplace"]);
  });

  it("decodes trusted TerraQura batch retirement calldata on CarbonCredit", () => {
    const detail = buildDetail(
      encodeDynamicArgs("0x31963830", [
        { type: "uint[]", value: [101n, 202n, 303n] },
        { type: "uint[]", value: [5n, 6n, 7n] },
        { type: "string", value: "Compliance retirement batch" },
      ]),
      { to: TRUSTED_CARBON_CREDIT },
    );
    const result = applyTerraQuraApprovalPresentation({
      app: TERRAQURA_APP,
      mode: "send",
      detail,
      defaultTitle: "Confirm transaction",
      defaultSummary: "TerraQura is asking to send a transaction.",
    });

    expect(result.title).toBe("Approve TerraQura batch retirement");
    expect(result.detail.decodedMethod).toBe("Batch carbon retirement");
    expect(result.detail.decodedParams).toEqual({
      "TerraQura contract": "CarbonCredit",
      "Retirement count": "3",
      "Credit token IDs": "101, 202, 303",
      "Retirement amounts": "5, 6, 7",
      Reason: "Compliance retirement batch",
    });
  });

  it("keeps generic copy and adds a warning when a TerraQura selector targets an unknown contract", () => {
    const detail = buildDetail(encodeUintArgs("0x70876c98", [42n, 7n]), {
      to: UNKNOWN_CONTRACT,
    });
    const result = applyTerraQuraApprovalPresentation({
      app: TERRAQURA_APP,
      mode: "send",
      detail,
      defaultTitle: "Confirm transaction",
      defaultSummary: "TerraQura is asking to send a transaction.",
    });

    expect(result.title).toBe("Confirm transaction");
    expect(result.summary).toBe("TerraQura is asking to send a transaction.");
    expect(result.detail.decodedMethod).toBeUndefined();
    expect(result.detail.warnings).toContain(
      "This calldata matches TerraQura's marketplace purchase flow, but 0x2222222222222222222222222222222222222222 is not in the wallet's trusted TerraQura registry for CarbonMarketplace or GaslessMarketplace.",
    );
  });

  it("keeps generic copy and adds an unpinned warning for retirement-certificate flows", () => {
    const detail = buildDetail(encodeDynamicArgs("0xfcbb5043", [
      { type: "uint", value: 7n },
      { type: "uint", value: 2n },
      { type: "string", value: "Aethelred Climate Reserve" },
      { type: "string", value: "Certificate issuance" },
    ]), {
      to: UNKNOWN_CONTRACT,
    });
    const result = applyTerraQuraApprovalPresentation({
      app: TERRAQURA_APP,
      mode: "send",
      detail,
      defaultTitle: "Confirm transaction",
      defaultSummary: "TerraQura is asking to send a transaction.",
    });

    expect(result.title).toBe("Confirm transaction");
    expect(result.summary).toBe("TerraQura is asking to send a transaction.");
    expect(result.detail.decodedMethod).toBeUndefined();
    expect(result.detail.warnings).toContain(
      "TerraQura's retirement certificate flow expects CarbonRetirement, but the wallet does not have a pinned deployment address for it yet. Review this transaction as an unverified contract interaction until the deployment is registered.",
    );
  });

  it("reports contract trust metadata for workflow and audit consumers", () => {
    const trustedDetail = buildDetail(encodeDynamicArgs("0xc081ec96", [
      { type: "uint", value: 88n },
      { type: "uint", value: 3n },
      { type: "string", value: "Offset retirement" },
    ]), {
      to: TRUSTED_CARBON_CREDIT,
    });
    const trustedAssessment = inspectTerraQuraTransaction(TERRAQURA_APP, trustedDetail);
    const untrustedAssessment = inspectTerraQuraTransaction(
      TERRAQURA_APP,
      buildDetail(encodeUintArgs("0x70876c98", [1n, 1n]), { to: UNKNOWN_CONTRACT }),
    );
    const unpinnedAssessment = inspectTerraQuraTransaction(
      TERRAQURA_APP,
      buildDetail(encodeDynamicArgs("0xfcbb5043", [
        { type: "uint", value: 7n },
        { type: "uint", value: 2n },
        { type: "string", value: "Aethelred Climate Reserve" },
        { type: "string", value: "Certificate issuance" },
      ]), { to: UNKNOWN_CONTRACT }),
    );

    expect(trustedAssessment.contractTrust).toBe("trusted");
    expect(trustedAssessment.targetContractLabel).toBe("CarbonCredit");
    expect(trustedAssessment.actionLabel).toBe("Carbon retirement");

    expect(untrustedAssessment.contractTrust).toBe("unrecognized");
    expect(untrustedAssessment.expectedContractLabels).toEqual(["CarbonMarketplace", "GaslessMarketplace"]);
    expect(untrustedAssessment.trustWarning).toContain("trusted TerraQura registry");

    expect(unpinnedAssessment.contractTrust).toBe("unpinned");
    expect(unpinnedAssessment.expectedContractLabels).toEqual(["CarbonRetirement"]);
    expect(unpinnedAssessment.trustWarning).toContain("does not have a pinned deployment address");
  });
});

function buildDetail(
  data: string,
  overrides: Partial<Extract<ApprovalDetail, { kind: "tx" }>> = {},
): Extract<ApprovalDetail, { kind: "tx" }> {
  return {
    kind: "tx",
    chainId: "0xaa36a7",
    from: "0x1111111111111111111111111111111111111111",
    to: UNKNOWN_CONTRACT,
    value: "0x0",
    data,
    nonce: 1,
    gasLimit: "0x5208",
    maxFeePerGas: "0x3b9aca00",
    maxPriorityFeePerGas: "0x3b9aca00",
    estimatedFee: "0x5208",
    simulationRisk: "low",
    warnings: [],
    ...overrides,
  };
}

function encodeUintArgs(selector: string, values: bigint[]): string {
  return `${selector}${values.map((value) => encodeUintWord(value)).join("")}`;
}

function encodeDynamicArgs(
  selector: string,
  args: Array<
    | { type: "uint"; value: bigint }
    | { type: "string"; value: string }
    | { type: "uint[]"; value: bigint[] }
  >,
): string {
  let dynamicOffset = args.length * 32;
  let head = "";
  let tail = "";

  for (const arg of args) {
    if (arg.type === "uint") {
      head += encodeUintWord(arg.value);
      continue;
    }

    const encoded = arg.type === "string"
      ? encodeStringData(arg.value)
      : encodeUintArrayData(arg.value);
    head += encodeUintWord(BigInt(dynamicOffset));
    tail += encoded;
    dynamicOffset += encoded.length / 2;
  }

  return `${selector}${head}${tail}`;
}

function encodeStringData(value: string): string {
  const valueHex = bytesToHex(new TextEncoder().encode(value));
  const padded = valueHex.padEnd(Math.ceil(valueHex.length / 64) * 64, "0");
  return `${encodeUintWord(BigInt(valueHex.length / 2))}${padded}`;
}

function encodeUintArrayData(values: bigint[]): string {
  return `${encodeUintWord(BigInt(values.length))}${values.map((value) => encodeUintWord(value)).join("")}`;
}

function encodeUintWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
