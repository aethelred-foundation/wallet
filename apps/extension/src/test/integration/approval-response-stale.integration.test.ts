import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";

describe("approval response stale resolver handling", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("returns an error envelope instead of ok:false success for a missing resolver", async () => {
    const response = await harness.sendMessage("approval-response", {
      approvalId: "approval-stale-after-worker-restart",
      decision: "approved",
    });

    expect(response.payload.result).toBeUndefined();
    expect(response.payload.error).toEqual(expect.objectContaining({
      code: -32002,
      message: expect.stringMatching(/no longer pending.*queue was refreshed/i),
    }));
  });
});
