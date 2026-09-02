import { describe, expect, it } from "vitest";
import {
  buildTransferTransaction,
  formatBaseUnitsForInput,
  parseDecimalAmountToBaseUnits,
} from "../popup/lib/transfer-transaction";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";

describe("wallet transfer transaction builder", () => {
  it("builds an exact native-value transfer without floating-point math", () => {
    const tx = buildTransferTransaction({
      tokenAddress: "native",
      tokenDecimals: 18,
      recipient: RECIPIENT,
      amount: "1.000000000000000001",
    });
    expect(tx.assetKind).toBe("native");
    expect(tx.to).toBe(RECIPIENT);
    expect(tx.value).toBe("0xde0b6b3a7640001");
    expect(tx.data).toBe("0x");
  });

  it("builds ERC-20 transfer calldata and sends zero native value", () => {
    const tx = buildTransferTransaction({
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      recipient: RECIPIENT,
      amount: "12.345678",
    });
    expect(tx.assetKind).toBe("erc20");
    expect(tx.to).toBe(TOKEN);
    expect(tx.value).toBe("0x0");
    expect(tx.data).toBe(
      "0xa9059cbb" +
      "0000000000000000000000001111111111111111111111111111111111111111" +
      "0000000000000000000000000000000000000000000000000000000000bc614e",
    );
  });

  it("rejects precision loss and malformed amounts", () => {
    expect(() => parseDecimalAmountToBaseUnits("0.0000001", 6)).toThrow(/more than 6/i);
    expect(() => parseDecimalAmountToBaseUnits("1e3", 18)).toThrow(/valid token amount/i);
    expect(() => parseDecimalAmountToBaseUnits("-1", 18)).toThrow(/valid token amount/i);
  });

  it("formats the MAX amount without losing the smallest unit", () => {
    expect(formatBaseUnitsForInput(1_000_000_000_000_000_001n, 18)).toBe(
      "1.000000000000000001",
    );
    expect(formatBaseUnitsForInput(12_340_000n, 6)).toBe("12.34");
  });
});
