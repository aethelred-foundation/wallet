import type { ProviderRpcErrorShape } from "./contracts";

export class ProviderRpcError extends Error implements ProviderRpcErrorShape {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

export const providerError = (code: number, message: string, data?: unknown) =>
  new ProviderRpcError(code, message, data);
