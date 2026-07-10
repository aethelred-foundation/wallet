/**
 * Native Cosmos SDK message encoders — the sovereign feature set.
 *
 * Each builder returns a protobuf `Any` (`{ typeUrl, value }`) ready to be
 * placed in `TxBody.messages`. Field numbers are taken from the canonical
 * cosmos-sdk proto definitions (v0.53 line, as integrated by aethelredd):
 *
 *   bank/v1beta1/tx.proto          MsgSend
 *   staking/v1beta1/tx.proto       MsgDelegate / MsgUndelegate / MsgBeginRedelegate
 *   distribution/v1beta1/tx.proto  MsgWithdrawDelegatorReward
 *   gov/v1/tx.proto                MsgVote
 *
 * Amounts are `Coin { denom, amount }` with the amount as a decimal string —
 * Aethelred's native bank denom is 6-decimal `uaethel` (the EVM face shows
 * the same balance as 18-decimal AETHEL via x/precisebank).
 */

import { ProtoWriter } from "./proto";

/** A protobuf `Any`: fully-qualified type URL + encoded message bytes. */
export interface AnyMsg {
  readonly typeUrl: string;
  readonly value: Uint8Array;
}

/** A native coin amount. `amount` is a base-10 integer string. */
export interface Coin {
  readonly denom: string;
  readonly amount: string;
}

/** gov v1 vote options (cosmos.gov.v1.VoteOption). */
export enum VoteOption {
  Yes = 1,
  Abstain = 2,
  No = 3,
  NoWithVeto = 4,
}

/** Encode a `cosmos.base.v1beta1.Coin`. */
export function encodeCoin(coin: Coin): Uint8Array {
  return new ProtoWriter()
    .string(1, coin.denom)
    .string(2, coin.amount)
    .finish();
}

/** `/cosmos.bank.v1beta1.MsgSend` — native AETHEL transfer. */
export function msgSend(params: {
  fromAddress: string;
  toAddress: string;
  amount: readonly Coin[];
}): AnyMsg {
  const w = new ProtoWriter()
    .string(1, params.fromAddress)
    .string(2, params.toAddress);
  for (const coin of params.amount) {
    w.embedded(3, encodeCoin(coin));
  }
  return { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: w.finish() };
}

/** `/cosmos.staking.v1beta1.MsgDelegate` — stake with a validator. */
export function msgDelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
}): AnyMsg {
  const value = new ProtoWriter()
    .string(1, params.delegatorAddress)
    .string(2, params.validatorAddress)
    .embedded(3, encodeCoin(params.amount))
    .finish();
  return { typeUrl: "/cosmos.staking.v1beta1.MsgDelegate", value };
}

/** `/cosmos.staking.v1beta1.MsgUndelegate` — begin unbonding. */
export function msgUndelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
}): AnyMsg {
  const value = new ProtoWriter()
    .string(1, params.delegatorAddress)
    .string(2, params.validatorAddress)
    .embedded(3, encodeCoin(params.amount))
    .finish();
  return { typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate", value };
}

/** `/cosmos.staking.v1beta1.MsgBeginRedelegate` — move stake between validators. */
export function msgBeginRedelegate(params: {
  delegatorAddress: string;
  validatorSrcAddress: string;
  validatorDstAddress: string;
  amount: Coin;
}): AnyMsg {
  const value = new ProtoWriter()
    .string(1, params.delegatorAddress)
    .string(2, params.validatorSrcAddress)
    .string(3, params.validatorDstAddress)
    .embedded(4, encodeCoin(params.amount))
    .finish();
  return { typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate", value };
}

/** `/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward` — claim rewards. */
export function msgWithdrawDelegatorReward(params: {
  delegatorAddress: string;
  validatorAddress: string;
}): AnyMsg {
  const value = new ProtoWriter()
    .string(1, params.delegatorAddress)
    .string(2, params.validatorAddress)
    .finish();
  return {
    typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    value,
  };
}

/** `/cosmos.gov.v1.MsgVote` — governance vote. */
export function msgVote(params: {
  proposalId: bigint;
  voter: string;
  option: VoteOption;
  metadata?: string;
}): AnyMsg {
  const value = new ProtoWriter()
    .uint64(1, params.proposalId)
    .string(2, params.voter)
    .uint64(3, params.option)
    .string(4, params.metadata ?? "")
    .finish();
  return { typeUrl: "/cosmos.gov.v1.MsgVote", value };
}

/** IBC client height (`ibc.core.client.v1.Height`). */
export interface IbcHeight {
  readonly revisionNumber: bigint;
  readonly revisionHeight: bigint;
}

/**
 * `/ibc.applications.transfer.v1.MsgTransfer` — ICS-20 cross-chain token
 * transfer.
 *
 * Standard-protocol encoder, usable today against any ibc-go chain (Cosmos
 * Hub, Osmosis, …) via this package's vanilla-`secp256k1` mode. HONEST
 * BOUNDARY for Aethelred itself: the chain currently wires a custom `x/ibc`
 * proof-relay module (TEE/ZK attestation relay), NOT ibc-go's ICS-20
 * transfer app — until that module lands in the app, Aethelred rejects this
 * message at decode. Client-side readiness, chain-side pending.
 *
 * Timeout semantics (standard ICS-20): set `timeoutHeight` OR
 * `timeoutTimestamp` (nanoseconds since epoch); the common pattern is a
 * zero height + now+10min timestamp. `timeout_height` is a non-nullable
 * gogoproto field and is therefore always emitted, even when zero.
 */
export function msgIbcTransfer(params: {
  sourcePort?: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  timeoutHeight?: IbcHeight;
  /** Unix NANOSECONDS. 0 = no timestamp timeout. */
  timeoutTimestamp?: bigint;
  memo?: string;
}): AnyMsg {
  const height = new ProtoWriter()
    .uint64(1, params.timeoutHeight?.revisionNumber ?? 0n)
    .uint64(2, params.timeoutHeight?.revisionHeight ?? 0n)
    .finish();
  const value = new ProtoWriter()
    .string(1, params.sourcePort ?? "transfer")
    .string(2, params.sourceChannel)
    .embedded(3, encodeCoin(params.token))
    .string(4, params.sender)
    .string(5, params.receiver)
    .embedded(6, height) // non-nullable in ibc-go: always present
    .uint64(7, params.timeoutTimestamp ?? 0n)
    .string(8, params.memo ?? "")
    .finish();
  return { typeUrl: "/ibc.applications.transfer.v1.MsgTransfer", value };
}
