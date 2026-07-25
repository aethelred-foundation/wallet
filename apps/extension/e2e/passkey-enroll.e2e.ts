/**
 * Passkey enrollment E2E.
 * ───────────────────────
 * Home → Profile → Security → Add passkey → name it → Enrol → the
 * credential appears in the authenticator list.
 *
 * Headless Chromium normally has no platform authenticator. Install a CDP
 * virtual CTAP2 authenticator so this test executes a real WebAuthn create
 * ceremony, including attested credential data, RP-ID binding, challenge
 * binding, user presence, and user verification.
 */

import { test, expect } from "./fixtures";

test("user can enroll a passkey and see it in the authenticator list", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  /* Onboard through the real background pipeline so Security is reachable. */
  await page.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    await new Promise((resolve) =>
      chromeApi.runtime.sendMessage(
        { kind: "init-wallet", payload: { password: "E2E-Passkey-Pass-123", label: "e2e" } },
        resolve,
      ),
    );
  });
  await page.reload();

  /* Profile → Security. */
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: /Security/i }).first().click();

  /* The support probe resolved true, so the row is enabled. */
  const addPasskey = page.getByRole("button", { name: /Add passkey/i });
  await expect(addPasskey).toBeEnabled({ timeout: 10_000 });
  await addPasskey.click();

  /* Enrollment sheet — name the authenticator and enrol. */
  await page.getByPlaceholder(/MacBook Touch ID/i).fill("E2E Authenticator");
  await page.getByRole("button", { name: /Enrol passkey/i }).click();

  /* The sheet closes and the credential is listed (empty state is gone). */
  await expect(page.getByText(/No passkeys enrolled/i)).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("E2E Authenticator").first()).toBeVisible();

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await page.close();
});
