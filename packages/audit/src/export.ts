import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AuditEvent, ExportPackage } from "./types";

/**
 * Creates an export package with integrity hash.
 * The integrity hash covers the entire event payload,
 * enabling verification that the export hasn't been tampered with.
 */
export function createExportPackage(events: AuditEvent[]): ExportPackage {
  if (events.length === 0) {
    return {
      version: "1.0.0",
      exportedAt: Date.now(),
      events: [],
      integrityHash: bytesToHex(sha256(new TextEncoder().encode("[]"))),
      chainStartSequence: 0,
      chainEndSequence: 0,
    };
  }

  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const serialized = JSON.stringify(sorted);
  const integrityHash = bytesToHex(sha256(new TextEncoder().encode(serialized)));

  return {
    version: "1.0.0",
    exportedAt: Date.now(),
    events: sorted,
    integrityHash,
    chainStartSequence: sorted[0].sequenceNumber,
    chainEndSequence: sorted[sorted.length - 1].sequenceNumber,
  };
}

/**
 * Verifies that an export package hasn't been tampered with.
 */
export function verifyExportPackage(pkg: ExportPackage): boolean {
  const serialized = JSON.stringify(
    [...pkg.events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  );
  const expectedHash = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  return pkg.integrityHash === expectedHash;
}
