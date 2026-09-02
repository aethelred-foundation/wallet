import { describe, expect, it } from "vitest";
import {
  Eip1559GasValidationError,
  resolveEffectiveEip1559GasParameters,
} from "../background/eip1559-gas";

describe("resolveEffectiveEip1559GasParameters", () => {
  it("rejects non-canonical caller quantities before approval", () => {
    expect(() =>
      resolveEffectiveEip1559GasParameters(
        { gas: "21000" },
        {
          gasLimit: 21_000n,
          maxFeePerGas: 30_000_000_000n,
          maxPriorityFeePerGas: 2_000_000_000n,
        },
      ),
    ).toThrow(Eip1559GasValidationError);
  });
});
