import { RpcClient } from "./rpc-client";

/**
 * StakingPositionFetcher — the live staking reader for the portfolio's
 * Staking tab (Cruzible gap W-2: "no staked-position card in the wallet").
 *
 * Reads the user's Cruzible liquid-staking position with plain `eth_call`s,
 * no ABI library (same bundle-size rationale as the abi-decoder):
 *
 *   stAETHEL.balanceOf(user)      — rebasing balance == underlying AETHEL
 *   stAETHEL.vault()              — the vault is DISCOVERED from the token's
 *                                   public immutable, so the wallet only needs
 *                                   the stAETHEL token in its token list; no
 *                                   separately-configured vault address that
 *                                   could drift from the token
 *   vault.getExchangeRate()       — 1e18-scaled stAETHEL→AETHEL rate
 *   vault.effectiveAPY()          — bps, COMPUTED on-chain from epoch rate
 *                                   checkpoints (never an operator number)
 *   vault.getUserWithdrawals(user) — unbonding queue entries + claimability
 *
 * Everything shown in the card is chain truth; there is deliberately no
 * fallback to seeded data — an RPC failure surfaces as an error, not as a
 * fake position.
 */

const SEL_BALANCE_OF = "0x70a08231"; // balanceOf(address)
const SEL_VAULT = "0xfbfa77cf"; // vault()
const SEL_EXCHANGE_RATE = "0xe6aa216c"; // getExchangeRate()
const SEL_EFFECTIVE_APY = "0x977ae810"; // effectiveAPY()
const SEL_USER_WITHDRAWALS = "0xe502eb68"; // getUserWithdrawals(address)

export interface StakingWithdrawal {
  /** Withdrawal id (decimal string) — the arg for withdraw(id). */
  id: string;
  /** AETHEL owed, raw wei as a decimal string (fixed at request time). */
  aethelWei: string;
  /** Unix seconds. */
  requestTime: number;
  completionTime: number;
  claimed: boolean;
  /** Derived: matured and not yet claimed. */
  claimable: boolean;
}

export interface StakingPosition {
  tokenAddress: string;
  /** Cruzible vault, resolved on-chain from stAETHEL.vault(). */
  vaultAddress: string;
  /** Raw stAETHEL balance in wei (decimal string). Rebasing — this IS the
   *  underlying AETHEL value. */
  stakedWei: string;
  /** 1e18-scaled exchange rate as a decimal string, e.g. "1000002950000000000". */
  exchangeRateWei: string;
  /** effectiveAPY() in basis points. */
  apyBps: number;
  withdrawals: StakingWithdrawal[];
}

function padAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function wordAt(hex: string, word: number): bigint {
  const start = word * 64;
  const slice = hex.slice(start, start + 64);
  if (slice.length !== 64) throw new Error(`staking decode: word ${word} out of range`);
  return BigInt("0x" + slice);
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

/** Decode a single uint256 return value to bigint (0n for empty returns). */
export function decodeUintReturn(hex: string | null | undefined): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

/** Decode an address return value (right-aligned word). */
export function decodeAddressReturn(hex: string | null | undefined): string | null {
  if (!hex || hex === "0x") return null;
  const body = strip0x(hex);
  if (body.length < 64) return null;
  return "0x" + body.slice(24, 64).toLowerCase();
}

/**
 * Decode the return of getUserWithdrawals(address):
 * a dynamic array of the vault's Withdrawal struct —
 * (uint256 id, uint256 shares, uint256 aethelAmount, uint256 requestTime,
 *  uint256 completionTime, bool claimed) — 6 static words per entry.
 */
export function decodeWithdrawals(hex: string | null | undefined, nowSec: number): StakingWithdrawal[] {
  if (!hex || hex === "0x") return [];
  const body = strip0x(hex);
  const tail = Number(wordAt(body, 0)) / 32; // byte offset → word index
  const count = Number(wordAt(body, tail));
  const out: StakingWithdrawal[] = [];
  for (let i = 0; i < count; i++) {
    const base = tail + 1 + i * 6;
    const claimed = wordAt(body, base + 5) !== 0n;
    const completionTime = Number(wordAt(body, base + 4));
    out.push({
      id: wordAt(body, base).toString(),
      aethelWei: wordAt(body, base + 2).toString(),
      requestTime: Number(wordAt(body, base + 3)),
      completionTime,
      claimed,
      claimable: !claimed && completionTime <= nowSec,
    });
  }
  return out;
}

export class StakingPositionFetcher {
  constructor(private readonly rpc: RpcClient) {}

  /**
   * Read the user's position against the given stAETHEL token. Returns null
   * when the token doesn't expose vault() (not a Cruzible receipt token).
   */
  async getPosition(userAddress: string, tokenAddress: string): Promise<StakingPosition | null> {
    const vaultRaw = await this.rpc.call<string>("eth_call", [
      { to: tokenAddress, data: SEL_VAULT },
      "latest",
    ]);
    const vaultAddress = decodeAddressReturn(vaultRaw);
    if (!vaultAddress || BigInt(vaultAddress) === 0n) return null;

    const user = padAddress(userAddress);
    const [balanceRaw, rateRaw, apyRaw, withdrawalsRaw] = await this.rpc.batch([
      { method: "eth_call", params: [{ to: tokenAddress, data: SEL_BALANCE_OF + user }, "latest"] },
      { method: "eth_call", params: [{ to: vaultAddress, data: SEL_EXCHANGE_RATE }, "latest"] },
      { method: "eth_call", params: [{ to: vaultAddress, data: SEL_EFFECTIVE_APY }, "latest"] },
      { method: "eth_call", params: [{ to: vaultAddress, data: SEL_USER_WITHDRAWALS + user }, "latest"] },
    ]);

    return {
      tokenAddress,
      vaultAddress,
      stakedWei: decodeUintReturn(balanceRaw as string).toString(),
      exchangeRateWei: decodeUintReturn(rateRaw as string).toString(),
      apyBps: Number(decodeUintReturn(apyRaw as string)),
      withdrawals: decodeWithdrawals(withdrawalsRaw as string, Math.floor(Date.now() / 1000)),
    };
  }
}
