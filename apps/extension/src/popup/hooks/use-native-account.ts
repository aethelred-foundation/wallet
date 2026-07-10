/**
 * useNativeAccount
 * ────────────────
 * The native (Cosmos-side) face of an Aethelred account.
 *
 * Every Aethelred account is ONE secp256k1 key with TWO renderings of the
 * same 20 bytes: the EVM `0x…` the wallet already shows, and the chain's
 * canonical bech32 `aethel1…`. This hook derives the canonical native
 * address (pure, offline — no network needed for identity) and loads the
 * native-side state (uaethel balance + staking delegations) from the
 * node's LCD.
 *
 * Honest failure mode: when the LCD is unreachable the identity is STILL
 * shown (it is derived locally from the address bytes); only balances and
 * delegations degrade, with `status: "unreachable"`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AETHELRED_NATIVE,
  CosmosLcdClient,
  ethHexToBech32,
} from "@aethelred/wallet-chain-cosmos";

export interface NativeDelegation {
  /** Validator operator address (`aethelvaloper1…`). */
  readonly validator: string;
  /** Delegated amount in uaethel (base units). */
  readonly amountUaethel: string;
}

export type NativeAccountStatus =
  | "loading"
  | "ready"
  | "unreachable"
  | "invalid-address";

export interface NativeAccountState {
  readonly status: NativeAccountStatus;
  /** Canonical `aethel1…` rendering; "" only for invalid-address. */
  readonly nativeAddress: string;
  /** Spendable balance in uaethel (base units, 6 decimals). */
  readonly balanceUaethel: string;
  readonly delegations: readonly NativeDelegation[];
  readonly refresh: () => void;
}

/** Format uaethel (6-dec base units) as a display AETHEL string. */
export function formatUaethel(amount: string): string {
  const padded = amount.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const frac = padded.slice(-6);
  return `${whole}.${frac}`;
}

export function useNativeAccount(
  evmAddress: string | undefined,
  lcdBaseUrl: string = AETHELRED_NATIVE.lcdEndpoints[0],
): NativeAccountState {
  // Identity is a pure derivation — compute it synchronously and never let
  // network state affect it.
  const nativeAddress = useMemo(() => {
    if (!evmAddress) return "";
    try {
      return ethHexToBech32(evmAddress, AETHELRED_NATIVE.hrp);
    } catch {
      return "";
    }
  }, [evmAddress]);

  const [status, setStatus] = useState<NativeAccountStatus>("loading");
  const [balanceUaethel, setBalanceUaethel] = useState("0");
  const [delegations, setDelegations] = useState<readonly NativeDelegation[]>(
    [],
  );
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!nativeAddress) {
      setStatus("invalid-address");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const client = new CosmosLcdClient({ baseUrl: lcdBaseUrl });
        const balance = await client.getBalance(nativeAddress, "uaethel");

        // Delegations: a 404/empty body means "none", not an error.
        let dels: NativeDelegation[] = [];
        try {
          const res = await fetch(
            `${lcdBaseUrl.replace(/\/+$/, "")}/cosmos/staking/v1beta1/delegations/${nativeAddress}`,
          );
          if (res.ok) {
            const json = (await res.json()) as {
              delegation_responses?: Array<{
                delegation: { validator_address: string };
                balance: { amount: string };
              }>;
            };
            dels = (json.delegation_responses ?? []).map((d) => ({
              validator: d.delegation.validator_address,
              amountUaethel: d.balance.amount,
            }));
          }
        } catch {
          // Balance loaded but staking route failed — still "ready" with
          // zero delegations rather than discarding the whole native view.
        }

        if (!cancelled) {
          setBalanceUaethel(balance.amount);
          setDelegations(dels);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nativeAddress, lcdBaseUrl, nonce]);

  return { status, nativeAddress, balanceUaethel, delegations, refresh };
}
