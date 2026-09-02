import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getTenantMigrationReleaseError,
  UNRELEASED_TENANT_MIGRATION_MESSAGE_KINDS,
} from "../background/tenant-migration-release-gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKGROUND_SOURCE = readFileSync(resolve(HERE, "..", "background.ts"), "utf8");
const PACKAGE_SCRIPT = readFileSync(
  resolve(HERE, "..", "..", "..", "..", "scripts", "package-extension.mjs"),
  "utf8",
);

describe("production tenant-migration release gate", () => {
  it.each(UNRELEASED_TENANT_MIGRATION_MESSAGE_KINDS)(
    "rejects reserved method %s with explicit EIP-1193 code 4200",
    (kind) => {
      expect(getTenantMigrationReleaseError(kind)).toEqual({
        code: 4200,
        message: expect.stringMatching(/migration operations are unavailable.*audited.*control plane/i),
      });
    },
  );

  it("does not intercept released wallet methods", () => {
    expect(getTenantMigrationReleaseError("get-state")).toBeNull();
    expect(getTenantMigrationReleaseError("rpc-request")).toBeNull();
  });

  it("gates before dispatch and contains no callable placeholder results", () => {
    expect(BACKGROUND_SOURCE).toContain("getTenantMigrationReleaseError(message.kind)");
    expect(BACKGROUND_SOURCE).not.toContain("deployment-migration-not-yet-wired");
    expect(BACKGROUND_SOURCE).not.toContain("TenantMigrationPlan");
    expect(BACKGROUND_SOURCE).not.toContain("new DeploymentManager");
    expect(BACKGROUND_SOURCE).not.toContain('case "tenant-list": {');
    expect(BACKGROUND_SOURCE).not.toContain('case "tenant-plan-migration": {');
  });

  it("keeps migration scaffolds and fabricated About claims on the package denylist", () => {
    for (const marker of [
      "deployment-migration-not-yet-wired",
      "TenantMigrationPlan",
      "DeploymentManager",
      "2026-04-14",
      "a3f8c2d",
      "Apple Grade design overhaul",
      "Dedicated ID Verification",
      "Premium splash animation",
    ]) {
      expect(PACKAGE_SCRIPT).toContain(JSON.stringify(marker));
    }
  });
});
