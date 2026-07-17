import {
  NATIVE_ASSET_SENTINEL,
  encodeErc20Transfer,
  isNativeAsset,
} from "@aethelred/wallet-transfer-solver";

export interface TransferTransactionInput {
  tokenAddress: string;
  tokenDecimals: number;
  recipient: string;
  amount: string;
}

export interface PreparedTransferTransaction {
  to: string;
  value: `0x${string}`;
  data: `0x${string}`;
  amountBaseUnits: bigint;
  assetKind: "native" | "erc20";
}

export function parseDecimalAmountToBaseUnits(
  value: string,
  decimals: number,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals are invalid");
  }
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("Enter a valid token amount");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  const wholeUnits = BigInt(match[1]) * 10n ** BigInt(decimals);
  const fractionUnits = fraction
    ? BigInt(fraction.padEnd(decimals, "0"))
    : 0n;
  return wholeUnits + fractionUnits;
}

export function formatBaseUnitsForInput(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token base units are invalid");
  }
  if (decimals === 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function isWalletNativeAsset(address: string): boolean {
  return address.toLowerCase() === "native" || isNativeAsset(address);
}

export function buildTransferTransaction(
  input: TransferTransactionInput,
): PreparedTransferTransaction {
  const amountBaseUnits = parseDecimalAmountToBaseUnits(
    input.amount,
    input.tokenDecimals,
  );
  if (amountBaseUnits <= 0n) throw new Error("Amount must be greater than zero");

  if (isWalletNativeAsset(input.tokenAddress)) {
    return {
      to: input.recipient,
      value: `0x${amountBaseUnits.toString(16)}`,
      data: "0x",
      amountBaseUnits,
      assetKind: "native",
    };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(input.tokenAddress)) {
    throw new Error("Token contract address is invalid");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.recipient)) {
    throw new Error("ERC-20 recipient must be a 0x-prefixed EVM address");
  }

  return {
    to: input.tokenAddress,
    value: "0x0",
    data: encodeErc20Transfer(input.recipient as `0x${string}`, amountBaseUnits),
    amountBaseUnits,
    assetKind: "erc20",
  };
}

export { NATIVE_ASSET_SENTINEL };
