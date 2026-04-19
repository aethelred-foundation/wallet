import type { MessageAnalysis, RiskSignal } from "./types";

/**
 * Analyzes messages before signing for phishing and risk signals.
 * Detects EIP-2612 permits, dangerous signature patterns, and suspicious content.
 */
export class MessageAnalyzer {
  analyze(message: string | Uint8Array, origin?: string): MessageAnalysis {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const riskSignals: RiskSignal[] = [];
    let isPermit = false;
    let isDangerousSignature = false;

    // Detect EIP-2612 permit signatures
    if (this.looksLikePermit(text)) {
      isPermit = true;
      riskSignals.push({
        id: "permit-signature",
        level: "high",
        category: "approval-risk",
        title: "Token permit signature",
        description: "This message grants token spending approval without an on-chain transaction. Verify the spender and amount carefully.",
      });
    }

    // Detect Seaport / NFT marketplace orders
    if (this.looksLikeOrder(text)) {
      riskSignals.push({
        id: "marketplace-order",
        level: "medium",
        category: "value-risk",
        title: "Marketplace order signature",
        description: "This message creates a marketplace order. Verify the assets and prices before signing.",
      });
    }

    // Detect suspiciously long hex data
    if (/^0x[a-fA-F0-9]{128,}$/.test(text)) {
      isDangerousSignature = true;
      riskSignals.push({
        id: "opaque-hex-data",
        level: "high",
        category: "phishing",
        title: "Opaque signature request",
        description: "This request asks you to sign raw hex data that cannot be decoded. This is often used in phishing attacks.",
      });
    }

    // Check for ETH/wallet drain patterns
    if (this.containsDrainPatterns(text)) {
      isDangerousSignature = true;
      riskSignals.push({
        id: "drain-pattern",
        level: "critical",
        category: "phishing",
        title: "Potential wallet drain",
        description: "This message contains patterns commonly used in wallet-draining attacks. Do not sign unless you are absolutely certain.",
      });
    }

    // Origin mismatch warnings
    if (origin && this.isSupiciousOrigin(origin)) {
      riskSignals.push({
        id: "suspicious-origin",
        level: "medium",
        category: "phishing",
        title: "Suspicious origin",
        description: `Request comes from ${origin} which may be attempting to impersonate a legitimate service.`,
      });
    }

    const overallRisk = riskSignals.length === 0 ? "safe" as const :
      riskSignals.some((s) => s.level === "critical") ? "critical" as const :
      riskSignals.some((s) => s.level === "high") ? "high" as const :
      riskSignals.some((s) => s.level === "medium") ? "medium" as const : "low" as const;

    return {
      isPermit,
      isDangerousSignature,
      decodedContent: this.decodeContent(text),
      riskSignals,
      overallRisk,
    };
  }

  private looksLikePermit(text: string): boolean {
    const permitPatterns = [
      "Permit",
      "permitTypehash",
      "spender",
      "nonce",
      "deadline",
      "EIP712Domain",
    ];
    const matches = permitPatterns.filter((p) => text.includes(p));
    return matches.length >= 3;
  }

  private looksLikeOrder(text: string): boolean {
    const orderPatterns = ["OrderComponents", "Seaport", "consideration", "offerer", "LooksRare"];
    return orderPatterns.some((p) => text.includes(p));
  }

  private containsDrainPatterns(text: string): boolean {
    const drainPatterns = [
      /setApprovalForAll.*true/i,
      /increaseAllowance.*(?:max|unlimited)/i,
    ];
    return drainPatterns.some((p) => p.test(text));
  }

  private isSupiciousOrigin(origin: string): boolean {
    const suspiciousPatterns = [
      /uniswap.*\.(?!org)/i,
      /opensea.*\.(?!io)/i,
      /metamask.*\.(?!io)/i,
      /aave.*\.(?!com)/i,
      /\.xyz$/i,
    ];
    return suspiciousPatterns.some((p) => p.test(origin));
  }

  private decodeContent(text: string): string {
    // Try to decode as UTF-8 human-readable message
    if (/^[\x20-\x7E\s]+$/.test(text)) {
      return text;
    }
    // Try to decode as EIP-712 typed data
    try {
      const parsed = JSON.parse(text);
      if (parsed.domain && parsed.types && parsed.message) {
        return `EIP-712 typed data: ${parsed.domain.name || "Unknown"} - ${Object.keys(parsed.message).join(", ")}`;
      }
    } catch { /* not JSON */ }

    return `Raw data (${text.length} bytes)`;
  }
}
