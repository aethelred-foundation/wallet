import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getCredentialReleaseError,
  UNRELEASED_CREDENTIAL_MESSAGE_KINDS,
} from "../background/credential-release-gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKGROUND_SOURCE = readFileSync(
  resolve(HERE, "..", "background.ts"),
  "utf8",
);
const PACKAGE_SCRIPT = readFileSync(
  resolve(HERE, "..", "..", "..", "..", "scripts", "package-extension.mjs"),
  "utf8",
);

describe("production credential release gate", () => {
  it.each(UNRELEASED_CREDENTIAL_MESSAGE_KINDS)(
    "fails %s closed with EIP-1193 unsupported-method code 4200",
    (kind) => {
      expect(getCredentialReleaseError(kind)).toEqual({
        code: 4200,
        message: expect.stringMatching(
          /unavailable.*verified issuer keys.*audited credential store/i,
        ),
      });
    },
  );

  it("does not intercept released wallet bridge methods", () => {
    expect(getCredentialReleaseError("get-state")).toBeNull();
    expect(getCredentialReleaseError("rpc-request")).toBeNull();
  });

  it("wires the gate into the real service-worker dispatcher and removes the preview runtime", () => {
    expect(BACKGROUND_SOURCE).toContain("getCredentialReleaseError(message.kind)");
    expect(BACKGROUND_SOURCE).not.toContain("@aethelred/wallet-credentials");
    expect(BACKGROUND_SOURCE).not.toContain("new CredentialManager");
    expect(BACKGROUND_SOURCE).not.toContain("signerPrivateKeyHex");
  });

  it("keeps placeholder issuers and private-key presentation code on the release bundle deny-list", () => {
    for (const marker of [
      "CredentialManager",
      "signerPrivateKeyHex",
      "Sumsub Global KYC",
      "FINRA-parallel-2022",
    ]) {
      expect(PACKAGE_SCRIPT).toContain(JSON.stringify(marker));
    }
    for (const chunk of [
      "chunks/credential-manager.js",
      "chunks/credentials.js",
      "chunks/issuer-registry.js",
    ]) {
      expect(PACKAGE_SCRIPT).toContain(JSON.stringify(chunk));
    }
  });
});
