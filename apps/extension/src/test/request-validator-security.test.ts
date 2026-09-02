import { describe, expect, it } from "vitest";
import {
  TRANSACTION_QUANTITY_FIELDS,
  normalizeTransactionRequest,
  validateRequest,
} from "@aethelred/wallet-connect";

describe("transaction RPC quantity validation", () => {
  it.each(TRANSACTION_QUANTITY_FIELDS)(
    "rejects a non-canonical %s before dispatch",
    (field) => {
      for (const invalid of ["999999999999999999", "0x", "0x00", "0x01", 1]) {
        const result = validateRequest({
          method: "eth_sendTransaction",
          params: [{
            from: "0x1111111111111111111111111111111111111111",
            [field]: invalid,
          }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.join(" ")).toMatch(
          new RegExp(`Transaction ${field}.*canonical 0x-prefixed`, "i"),
        );
      }
    },
  );

  it("detaches and canonicalizes the exact tuple used downstream", () => {
    const callerOwned = {
      from: "0x1111111111111111111111111111111111111111",
      value: "0xABCD",
      gas: "0x5208",
    };
    const result = validateRequest({
      method: "eth_sendTransaction",
      params: [callerOwned],
    });

    expect(result.valid).toBe(true);
    const [canonical] = result.normalizedParams as Array<Record<string, unknown>>;
    expect(canonical).not.toBe(callerOwned);
    expect(canonical).toMatchObject({ value: "0xabcd", gas: "0x5208" });

    callerOwned.value = "0x1";
    expect(canonical.value).toBe("0xabcd");
  });

  it("rejects the catastrophic decimal-looking value instead of reinterpreting it as hex", () => {
    const result = normalizeTransactionRequest({
      from: "0x1111111111111111111111111111111111111111",
      value: "999999999999999999",
    });
    expect(result.valid).toBe(false);
  });
});
