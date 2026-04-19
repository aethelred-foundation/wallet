import { RpcClient } from "./rpc-client";

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
  constructor(private readonly rpc: RpcClient) {}

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
    try {
      const hex = await this.rpc.call<string>("eth_estimateGas", [tx]);
      // Add 20% buffer for safety
      const estimated = BigInt(hex);
      return (estimated * BigInt(120)) / BigInt(100);
    } catch {
      // Default gas limits by transaction type
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
