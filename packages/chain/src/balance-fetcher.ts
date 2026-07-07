import { RpcClient } from "./rpc-client";

export interface TokenBalance {
  address: string; // "native" for ETH
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string; // hex
  balance: string; // human-readable
  logoColor?: string;
}

// ERC20 balanceOf(address) selector
const BALANCE_OF_SELECTOR = "0x70a08231";
const SYMBOL_SELECTOR = "0x95d89b41";
const DECIMALS_SELECTOR = "0x313ce567";
const NAME_SELECTOR = "0x06fdde03";

function formatBalance(rawHex: string, decimals: number): string {
  const raw = BigInt(rawHex || "0x0");
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  const fractional = remainder.toString().padStart(decimals, "0").slice(0, 4);
  const formatted = `${whole.toLocaleString()}.${fractional}`;
  return formatted.replace(/\.?0+$/, "") || "0";
}

function padAddress(address: string): string {
  return "0x" + address.slice(2).padStart(64, "0");
}

/**
 * Fetches native and ERC-20 token balances from the chain.
 * Uses batch RPC calls for efficiency.
 */
export class BalanceFetcher {
  constructor(
    private readonly rpc: RpcClient,
    // The active network's native coin. Defaults to Ether so existing
    // callers are unaffected; the background passes the active network's
    // nativeCurrency so the native row shows AETHEL on Aethelred, ETH on
    // Ethereum, etc. — rather than always labelling it "ETH".
    private readonly nativeCurrency: {
      symbol: string;
      name: string;
      decimals: number;
    } = { symbol: "ETH", name: "Ether", decimals: 18 },
  ) {}

  async getNativeBalance(address: string): Promise<TokenBalance> {
    const rawBalance = await this.rpc.call<string>("eth_getBalance", [address, "latest"]);
    return {
      address: "native",
      symbol: this.nativeCurrency.symbol,
      name: this.nativeCurrency.name,
      decimals: this.nativeCurrency.decimals,
      rawBalance,
      balance: formatBalance(rawBalance, this.nativeCurrency.decimals),
    };
  }

  async getErc20Balance(
    tokenAddress: string,
    ownerAddress: string,
    tokenInfo?: { symbol: string; name: string; decimals: number }
  ): Promise<TokenBalance> {
    const data = BALANCE_OF_SELECTOR + padAddress(ownerAddress).slice(2);
    const rawBalance = await this.rpc.call<string>("eth_call", [
      { to: tokenAddress, data },
      "latest",
    ]);

    const info = tokenInfo ?? (await this.fetchTokenInfo(tokenAddress));

    return {
      address: tokenAddress,
      symbol: info.symbol,
      name: info.name,
      decimals: info.decimals,
      rawBalance,
      balance: formatBalance(rawBalance, info.decimals),
    };
  }

  async getMultipleBalances(
    ownerAddress: string,
    tokens: Array<{ address: string; symbol: string; name: string; decimals: number }>
  ): Promise<TokenBalance[]> {
    const results: TokenBalance[] = [];

    // Native balance
    try {
      results.push(await this.getNativeBalance(ownerAddress));
    } catch {
      results.push({
        address: "native",
        symbol: "ETH",
        name: "Ether",
        decimals: 18,
        rawBalance: "0x0",
        balance: "0",
      });
    }

    // ERC-20 balances via batch
    const batchRequests = tokens.map((token) => ({
      method: "eth_call",
      params: [
        { to: token.address, data: BALANCE_OF_SELECTOR + padAddress(ownerAddress).slice(2) },
        "latest",
      ],
    }));

    try {
      const batchResults = await this.rpc.batch(batchRequests);
      for (let i = 0; i < tokens.length; i++) {
        const rawBalance = (batchResults[i] as string) ?? "0x0";
        results.push({
          address: tokens[i].address,
          symbol: tokens[i].symbol,
          name: tokens[i].name,
          decimals: tokens[i].decimals,
          rawBalance,
          balance: formatBalance(rawBalance, tokens[i].decimals),
        });
      }
    } catch {
      // Fallback: add zero balances
      for (const token of tokens) {
        results.push({ ...token, rawBalance: "0x0", balance: "0" });
      }
    }

    return results;
  }

  /**
   * Fetch ERC-20 metadata for a token address.
   *
   * Previously this called `symbol()` + `decimals()` but set `name = symbol`
   * because it never asked the chain for the real name. For tokens where
   * name ≠ symbol (MakerDAO: "Maker" / "MKR", Aave: "Aave Token" / "AAVE",
   * Chainlink: "ChainLink Token" / "LINK") this produced wrong display
   * labels. The fix adds a third `name()` call to the batch — a minimal
   * RPC-cost increase (~5% per token fetch) for a significant UX win.
   */
  private async fetchTokenInfo(
    tokenAddress: string
  ): Promise<{ symbol: string; name: string; decimals: number }> {
    try {
      const [nameRaw, symbolRaw, decimalsRaw] = await this.rpc.batch([
        { method: "eth_call", params: [{ to: tokenAddress, data: NAME_SELECTOR }, "latest"] },
        { method: "eth_call", params: [{ to: tokenAddress, data: SYMBOL_SELECTOR }, "latest"] },
        { method: "eth_call", params: [{ to: tokenAddress, data: DECIMALS_SELECTOR }, "latest"] },
      ]);

      const decimals = parseInt(decimalsRaw as string, 16) || 18;
      const symbol = this.decodeString(symbolRaw as string) || "???";
      // If name() reverts or decodes empty, fall back to the symbol —
      // better than showing "Unknown Token" for tokens that implement
      // only the minimal ERC-20 interface.
      const name = this.decodeString(nameRaw as string) || symbol;

      return { symbol, name, decimals };
    } catch {
      return { symbol: "???", name: "Unknown Token", decimals: 18 };
    }
  }

  private decodeString(hex: string): string {
    if (!hex || hex === "0x") return "";
    try {
      // ABI-encoded string: offset (32 bytes) + length (32 bytes) + data
      const data = hex.slice(2);
      if (data.length < 128) {
        // Might be bytes32 encoded
        const bytes = new Uint8Array(data.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
        }
        return new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
      }
      const lengthHex = data.slice(64, 128);
      const length = parseInt(lengthHex, 16);
      const strHex = data.slice(128, 128 + length * 2);
      const bytes = new Uint8Array(strHex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(strHex.slice(i * 2, i * 2 + 2), 16);
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }
}
