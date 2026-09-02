/**
 * LIVE-NODE proof for the native Cosmos tx path (Phase B, part b).
 *
 * Runs the wallet's @aethelred/wallet-chain-cosmos stack against a REAL
 * running aethelredd (EVM-enabled branch): account query → SIGN_MODE_DIRECT
 * MsgSend → broadcast → execution (code 0) → recipient balance delta →
 * MsgDelegate to the live validator → delegation visible on-chain.
 *
 * This is the strongest claim in the stack: the node's ante handler ACCEPTS
 * an eth_secp256k1-signed native transaction built by the wallet's own
 * protobuf writer + keccak digest signer (the static half of this proof —
 * decode + sig verify with the app's codec — lives in the chain repo at
 * app/wallet_native_txcompat_test.go).
 *
 * Env-gated so CI never needs a chain (mirrors aethelred-localnet.test.ts):
 *
 *   AETHELRED_NATIVE_LCD=http://127.0.0.1:1317 \
 *   [AETHELRED_NATIVE_CHAIN_ID=aethelred-testnet-1] \
 *   npx vitest run src/test/aethelred-native-localnet.test.ts
 *
 * Operator prep (test-only fixed key — NEVER a real account):
 *   aethelredd tx bank send validator \
 *     aethel1zg6x8f9sv4ezaxg3t4kzytex0kw2hdfydwvs8e 100000000uaethel …
 */

import { describe, expect, it } from "vitest";

import {
  AETHELRED_HRP,
  AETHELRED_NATIVE,
  CosmosLcdClient,
  addressBytesFromPubkey,
  compressedPubkey,
  msgDelegate,
  msgSend,
  nobleDigestSigner,
  signDirect,
  toBech32,
} from "@aethelred/wallet-chain-cosmos";

const LCD = process.env.AETHELRED_NATIVE_LCD ?? "";
const CHAIN_ID =
  process.env.AETHELRED_NATIVE_CHAIN_ID ?? AETHELRED_NATIVE.chainId;

const fromHex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/** Deterministic TEST key (same as chain-cosmos golden test; funded by op). */
const SENDER_KEY = fromHex(
  "2e0834786285daccd064ca17f1654f67b4aef298acbb82cef9ec422fb4975622",
);
/** A second throwaway key so the send has an observable recipient delta. */
const RECIPIENT_KEY = fromHex(
  "4f1d3a2b5c6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f701",
);

const describeLive = LCD ? describe : describe.skip;

describeLive("aethelred native localnet (LIVE)", () => {
  const senderPub = compressedPubkey(SENDER_KEY);
  const sender = toBech32(
    AETHELRED_HRP,
    addressBytesFromPubkey(senderPub, "eth_secp256k1"),
  );
  const recipient = toBech32(
    AETHELRED_HRP,
    addressBytesFromPubkey(compressedPubkey(RECIPIENT_KEY), "eth_secp256k1"),
  );
  const client = new CosmosLcdClient({ baseUrl: LCD });
  const fee = {
    amount: [{ denom: "uaethel", amount: "5000" }],
    gasLimit: 250_000n,
  };

  it(
    "bank send: sign → broadcast → executed → recipient balance moved",
    { timeout: 90_000 },
    async () => {
      const account = await client.getAccount(sender);
      const before = await client.getBalance(recipient, "uaethel");

      const amount = "1000000"; // 1 AETHEL
      const signed = await signDirect({
        messages: [
          msgSend({
            fromAddress: sender,
            toAddress: recipient,
            amount: [{ denom: "uaethel", amount }],
          }),
        ],
        memo: "wallet-native-live-e2e",
        fee,
        chainId: CHAIN_ID,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
        pubkey: senderPub,
        algo: "eth_secp256k1",
        signer: nobleDigestSigner(SENDER_KEY),
      });

      const broadcast = await client.broadcastTx(signed.txRaw);
      expect(broadcast.code, broadcast.rawLog).toBe(0);
      expect(broadcast.txHash).toBe(signed.txHash);

      const result = await client.waitForTx(broadcast.txHash, {
        timeoutMs: 60_000,
      });
      expect(result.code, result.rawLog).toBe(0);
      expect(result.height).toBeGreaterThan(0n);

      const after = await client.getBalance(recipient, "uaethel");
      expect(BigInt(after.amount) - BigInt(before.amount)).toBe(
        BigInt(amount),
      );
    },
  );

  it(
    "staking: delegate to the live validator, delegation visible on-chain",
    { timeout: 90_000 },
    async () => {
      // Discover the genesis validator from the node itself.
      const res = await fetch(`${LCD}/cosmos/staking/v1beta1/validators`);
      const { validators } = (await res.json()) as {
        validators: Array<{ operator_address: string }>;
      };
      expect(validators.length).toBeGreaterThan(0);
      const valoper = validators[0].operator_address;
      expect(valoper.startsWith(AETHELRED_NATIVE.valoperHrp)).toBe(true);

      const account = await client.getAccount(sender);
      const amount = "5000000"; // 5 AETHEL
      const signed = await signDirect({
        messages: [
          msgDelegate({
            delegatorAddress: sender,
            validatorAddress: valoper,
            amount: { denom: "uaethel", amount },
          }),
        ],
        fee,
        chainId: CHAIN_ID,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
        pubkey: senderPub,
        algo: "eth_secp256k1",
        signer: nobleDigestSigner(SENDER_KEY),
      });

      const broadcast = await client.broadcastTx(signed.txRaw);
      expect(broadcast.code, broadcast.rawLog).toBe(0);
      const result = await client.waitForTx(broadcast.txHash, {
        timeoutMs: 60_000,
      });
      expect(result.code, result.rawLog).toBe(0);

      const dres = await fetch(
        `${LCD}/cosmos/staking/v1beta1/delegations/${sender}`,
      );
      const { delegation_responses } = (await dres.json()) as {
        delegation_responses: Array<{
          delegation: { validator_address: string };
          balance: { denom: string; amount: string };
        }>;
      };
      const mine = delegation_responses.find(
        (d) => d.delegation.validator_address === valoper,
      );
      expect(mine).toBeDefined();
      expect(BigInt(mine!.balance.amount)).toBeGreaterThanOrEqual(
        BigInt(amount),
      );
    },
  );
});
