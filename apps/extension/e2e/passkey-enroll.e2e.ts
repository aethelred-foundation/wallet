/**
 * Passkey enrollment E2E.
 * ───────────────────────
 * Home → Profile → Security → Add passkey → name it → Enrol → the
 * credential appears in the authenticator list.
 *
 * The WebAuthn surface is stubbed before any extension script runs. Two
 * things must be faked, and the previous version of this spec faked only
 * the first, so the "Add passkey" row stayed disabled forever:
 *
 *   1. `navigator.credentials.create()` — returns the attestation.
 *   2. `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 *      — the support probe (`verifySupport`) requires a user-verifying
 *      platform authenticator; headless Chromium has none, so the row is
 *      disabled and the enroll sheet can never open.
 *
 * The stub returns the shapes the production extractor actually reads:
 * `rawId` plus `response.getPublicKey()` (SPKI) and `response.getTransports()`.
 * A DER-wrapped P-256 SPKI is used because the background verifier only
 * accepts ES256 (COSE alg -7).
 */

import { test, expect } from "./fixtures";

test("user can enroll a passkey and see it in the authenticator list", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const page = await context.newPage();

  /* Stub WebAuthn BEFORE the popup loads. */
  await page.addInitScript(() => {
    // 91-byte SPKI header + uncompressed P-256 point (0x04 ‖ X ‖ Y).
    const spki = new Uint8Array(91);
    spki.set(
      [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
        0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04,
      ],
      0,
    );
    for (let i = 27; i < 91; i += 1) spki[i] = (i * 7) % 251;

    const rawId = new Uint8Array([1, 2, 3, 4]).buffer;
    const fakeCredential = {
      id: "e2e-passkey-id",
      rawId,
      type: "public-key",
      response: {
        clientDataJSON: new TextEncoder().encode("{}").buffer,
        attestationObject: new Uint8Array([5, 6, 7, 8]).buffer,
        getPublicKey: () => spki.buffer,
        getTransports: () => ["internal"],
      },
    };

    Object.defineProperty(navigator, "credentials", {
      value: {
        create: async () => fakeCredential,
        get: async () => fakeCredential,
      },
      configurable: true,
    });

    // The support probe gates the "Add passkey" row.
    Object.defineProperty(window, "PublicKeyCredential", {
      value: class {
        static isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
      },
      configurable: true,
    });
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

  await page.close();
});
