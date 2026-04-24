#!/usr/bin/env node
// Thin shell around runCli for `npx aethelred-export`.
//
// Kept minimal on purpose: the heavy lifting is in src/cli.ts, which
// is testable under vitest. This file just wires process.argv,
// stdout, and fs.writeFile into a CliContext. Operators who need
// a custom data source / signer invoke runCli from their own
// script rather than through the bundled shell.

import { writeFile } from "node:fs/promises";

import { runCli } from "../src/index.ts";

// Operators plug their own data source via a sibling script; this
// default shell is intended as a smoke-test entry point.
const context = {
  dataSource: {
    async listAuditEvents() {
      return [];
    },
    async listKycProfiles() {
      return [];
    },
    async listTravelRuleEvents() {
      return [];
    },
    async listSubjectTransactions() {
      return [];
    },
  },
  writeFile,
  writeStdout: (data) => process.stdout.write(data + "\n"),
};

try {
  await runCli(process.argv.slice(2), context);
} catch (err) {
  process.stderr.write(`error: ${err.message ?? err}\n`);
  process.exit(1);
}
