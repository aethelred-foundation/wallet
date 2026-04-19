import type {
  AethelredConnectKernel,
  AethelredWalletState,
  DiscoveryInfo,
  EIP1193RequestArguments,
  ProviderEventName
} from "./contracts";

interface ProviderEventPayloads {
  accountsChanged: string[];
  chainChanged: string;
  connect: { chainId?: string };
  disconnect: { code: number; message: string };
  message: unknown;
  "aethelred:stateChanged": AethelredWalletState;
}

type Listener<K extends ProviderEventName> = (payload: ProviderEventPayloads[K]) => void;

const DEFAULT_DISCOVERY_INFO: DiscoveryInfo = {
  uuid: "aethelred-wallet-alpha",
  name: "Aethelred Wallet",
  icon:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='20' fill='%23111a24'/%3E%3Cpath d='M17 45L31 15l16 30h-8l-2.4-5H27.5L25 45h-8zm14-12h2.8L32.4 30 31 33z' fill='%23f5efe6'/%3E%3C/svg%3E",
  rdns: "org.aethelred.wallet"
};

export class AethelredProvider {
  readonly isAethelred = true;
  readonly info: DiscoveryInfo;
  private readonly listeners = new Map<
    ProviderEventName,
    Set<Listener<ProviderEventName>>
  >();
  private readonly unsubscribe: () => void;

  constructor(private readonly kernel: AethelredConnectKernel, info?: Partial<DiscoveryInfo>) {
    this.info = {
      ...DEFAULT_DISCOVERY_INFO,
      ...info
    };

    this.unsubscribe = this.kernel.subscribe((state) => {
      this.emit("aethelred:stateChanged", state);
    });
  }

  request(args: EIP1193RequestArguments) {
    return this.kernel.request(args);
  }

  snapshot(): AethelredWalletState {
    return this.kernel.getState();
  }

  on<K extends ProviderEventName>(event: K, listener: Listener<K>) {
    const listeners =
      this.listeners.get(event) ?? new Set<Listener<ProviderEventName>>();
    listeners.add(listener as Listener<ProviderEventName>);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener<K extends ProviderEventName>(event: K, listener: Listener<K>) {
    const listeners = this.listeners.get(event);
    listeners?.delete(listener as Listener<ProviderEventName>);
    return this;
  }

  destroy() {
    this.unsubscribe();
    this.listeners.clear();
  }

  private emit<K extends ProviderEventName>(event: K, payload: ProviderEventPayloads[K]) {
    const listeners = this.listeners.get(event);

    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }
}
