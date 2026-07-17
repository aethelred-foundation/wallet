import { RpcClient } from "./rpc-client";

// Aethelred EVM chain IDs (mainnet / testnet / devnet). The node's
// eth_estimateGas under-reports gas for state-changing calls — it returns
// roughly the intrinsic cost — so the standard 20% buffer still reverts
// out-of-gas the moment a contract call touches storage. On these chains we
// buffer aggressively and floor contract calls to a safe minimum; the Cosmos
// fee market refunds unused gas, so over-estimating the LIMIT costs nothing.
// Every other EVM chain keeps the conservative 20% buffer.
const AETHELRED_CHAIN_IDS = new Set([7331, 7332, 7333]);
const AETHELRED_GAS_MULTIPLIER = BigInt(8);
const AETHELRED_CONTRACT_GAS_FLOOR = BigInt(700_000);
const AETHELRED_GAS_CEILING = BigInt(30_000_000);

export interface GasEstimate {
  // Legacy gas price
  gasPrice: bigint;
  // EIP-1559 fee fields
  baseFee: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  // Gas limit for specific transaction
  gasLimit: bigint;
  // USD cost estimate
  estimatedCostWei: bigint;
  estimatedCostEth: string;
}

export interface GasTier {
  label: string;
  speed: string;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedSeconds: number;
}

/**
 * Gas oracle that queries the chain for real gas prices.
 * Supports both legacy and EIP-1559 fee estimation.
 */
export class GasOracle {
  private cachedChainId: number | null = null;

  constructor(private readonly rpc: RpcClient) {}

  /**
   * Whether the connected chain is an Aethelred EVM network. Cached after the
   * first lookup; on any RPC failure we assume a standard chain (safer default,
   * since the aggressive buffer is only correct for Aethelred).
   */
  private async isAethelredChain(): Promise<boolean> {
    if (this.cachedChainId === null) {
      try {
        const hex = await this.rpc.call<string>("eth_chainId");
        this.cachedChainId = Number(BigInt(hex));
      } catch {
        return false;
      }
    }
    return AETHELRED_CHAIN_IDS.has(this.cachedChainId);
  }

  async getGasPrice(): Promise<bigint> {
    const hex = await this.rpc.call<string>("eth_gasPrice");
    return BigInt(hex);
  }

  async getBaseFee(): Promise<bigint> {
    const block = await this.rpc.call<{ baseFeePerGas?: string }>("eth_getBlockByNumber", ["latest", false]);
    if (!block?.baseFeePerGas) {
      // Chain doesn't support EIP-1559, fall back to gasPrice
      return this.getGasPrice();
    }
    return BigInt(block.baseFeePerGas);
  }

  async getMaxPriorityFee(): Promise<bigint> {
    try {
      const hex = await this.rpc.call<string>("eth_maxPriorityFeePerGas");
      return BigInt(hex);
    } catch {
      // Fallback: use 1.5 gwei as default priority fee
      return BigInt("1500000000");
    }
  }

  async estimateGas(tx: {
    from: string;
    to?: string;
    value?: string;
    data?: string;
  }): Promise<bigint> {
    const isContractCall = !tx.to || (tx.data !== undefined && tx.data.length > 2);
    try {
      const hex = await this.rpc.call<string>("eth_estimateGas", [tx]);
      const estimated = BigInt(hex);

      if (await this.isAethelredChain()) {
        // Aethelred under-reports; buffer 8x, floor contract calls, cap the top.
        let buffered = estimated * AETHELRED_GAS_MULTIPLIER;
        if (isContractCall && buffered < AETHELRED_CONTRACT_GAS_FLOOR) {
          buffered = AETHELRED_CONTRACT_GAS_FLOOR;
        }
        return buffered > AETHELRED_GAS_CEILING ? AETHELRED_GAS_CEILING : buffered;
      }

      // Standard EVM chains: eth_estimateGas is accurate, 20% is plenty.
      return (estimated * BigInt(120)) / BigInt(100);
    } catch {
      // eth_estimateGas itself failed — fall back to type-based defaults.
      // Aethelred's floor is higher because its estimates run low across the board.
      if (await this.isAethelredChain()) {
        return isContractCall ? AETHELRED_CONTRACT_GAS_FLOOR : BigInt(21_000);
      }
      if (!tx.to) return BigInt(500_000); // Contract deployment
      if (tx.data && tx.data.length > 2) return BigInt(100_000); // Contract call
      return BigInt(21_000); // Simple transfer
    }
  }

  async getGasTiers(): Promise<{ slow: GasTier; standard: GasTier; fast: GasTier }> {
    const [baseFee, priorityFee] = await Promise.all([
      this.getBaseFee(),
      this.getMaxPriorityFee(),
    ]);

    const slow: GasTier = {
      label: "Slow",
      speed: "~5 min",
      maxPriorityFeePerGas: priorityFee / BigInt(2),
      maxFeePerGas: baseFee + priorityFee / BigInt(2),
      estimatedSeconds: 300,
    };

    const standard: GasTier = {
      label: "Standard",
      speed: "~30 sec",
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: baseFee * BigInt(2) + priorityFee,
      estimatedSeconds: 30,
    };

    const fast: GasTier = {
      label: "Fast",
      speed: "~15 sec",
      maxPriorityFeePerGas: priorityFee * BigInt(2),
      maxFeePerGas: baseFee * BigInt(3) + priorityFee * BigInt(2),
      estimatedSeconds: 15,
    };

    return { slow, standard, fast };
  }

  async getFullEstimate(tx: {
    from: string;
    to?: string;
    value?: string;
    data?: string;
  }): Promise<GasEstimate> {
    const [gasPrice, baseFee, priorityFee, gasLimit] = await Promise.all([
      this.getGasPrice(),
      this.getBaseFee(),
      this.getMaxPriorityFee(),
      this.estimateGas(tx),
    ]);

    const maxFeePerGas = baseFee * BigInt(2) + priorityFee;
    const estimatedCostWei = gasLimit * maxFeePerGas;

    return {
      gasPrice,
      baseFee,
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas,
      gasLimit,
      estimatedCostWei,
      estimatedCostEth: formatWei(estimatedCostWei),
    };
  }
}

function formatWei(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth < 0.0001) return "<0.0001";
  return eth.toFixed(6);
}
