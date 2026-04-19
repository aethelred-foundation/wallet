import type { DiscoveryInfo } from "./contracts";
import { AethelredProvider } from "./provider";

export const EIP6963_ANNOUNCE = "eip6963:announceProvider";
export const EIP6963_REQUEST = "eip6963:requestProvider";

export const announceProvider = (
  provider: AethelredProvider,
  info?: Partial<DiscoveryInfo>
) => {
  if (typeof window === "undefined") {
    return;
  }

  const detail = {
    info: {
      ...provider.info,
      ...info
    },
    provider
  };

  window.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE, { detail }));
};

export const registerDiscovery = (
  provider: AethelredProvider,
  info?: Partial<DiscoveryInfo>
) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const listener = () => announceProvider(provider, info);

  window.addEventListener(EIP6963_REQUEST, listener);
  listener();

  return () => {
    window.removeEventListener(EIP6963_REQUEST, listener);
  };
};
