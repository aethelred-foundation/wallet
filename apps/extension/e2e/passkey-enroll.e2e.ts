/**
 * Passkey-enrollment E2E.
 * ───────────────────────
 * Security Settings → Add passkey → Enrollment success.
 *
 * `navigator.credentials.create` is stubbed via `addInitScript` so the
 * test is deterministic — we're verifying the view's integration with
 * the WebAuthn API, not the authenticator hardware path.
 */

import { test, expect } from "./fixtures";

test("user can enroll a passkey and see the success confirmation", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  /* Stub WebAuthn BEFORE the popup loads. */
  await page.addInitScript(() => {
    const fakeCredential = {
      id: "e2e-passkey-id",
      rawId: new Uint8Array([1, 2, 3, 4]).buffer,
      response: {
        clientDataJSON: new TextEncoder().encode("{}").buffer,
        attestationObject: new Uint8Array([5, 6, 7, 8]).buffer,
      },
      type: "public-key",
    };
    Object.defineProperty(navigator, "credentials", {
      value: {
        create: async () => fakeCredential,
        get: async () => fakeCredential,
      },
      configurable: true,
    });
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  /* Navigate to Security settings — the route is reachable via nav. */
  const securityLink = page.getByRole("button", { name: /Security|Settings/i });
  if (await securityLink.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await securityLink.first().click();
  }

  const addPasskeyBtn = page.getByRole("button", { name: /Add passkey|Enroll passkey/i });
  await expect(addPasskeyBtn.first()).toBeVisible({ timeout: 5_000 });
  await addPasskeyBtn.first().click();

  /* Success indicator. */
  await expect(page.getByText(/Passkey (added|enrolled|saved)/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.close();
});
