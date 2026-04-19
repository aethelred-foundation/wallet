import type { AddressReputation } from "./types";

/**
 * Address reputation and labeling service.
 * Maintains a local address book with known labels and scam detection.
 */
export class AddressBook {
  private entries = new Map<string, AddressReputation>();
  private contacts = new Map<string, { label: string; addedAt: number }>();

  constructor() {
    this.seedKnownAddresses();
  }

  lookup(address: string): AddressReputation {
    const normalized = address.toLowerCase();
    const known = this.entries.get(normalized);
    if (known) return known;

    const contact = this.contacts.get(normalized);
    return {
      address,
      label: contact?.label,
      isContract: false,
      isKnownScam: false,
      isKnownProtocol: false,
      riskLevel: "low",
      tags: contact ? ["contact"] : [],
    };
  }

  addContact(address: string, label: string): void {
    this.contacts.set(address.toLowerCase(), {
      label,
      addedAt: Date.now(),
    });
  }

  removeContact(address: string): void {
    this.contacts.delete(address.toLowerCase());
  }

  listContacts(): Array<{ address: string; label: string; addedAt: number }> {
    return Array.from(this.contacts.entries()).map(([address, info]) => ({
      address,
      ...info,
    }));
  }

  isKnownScam(address: string): boolean {
    const entry = this.entries.get(address.toLowerCase());
    return entry?.isKnownScam ?? false;
  }

  private seedKnownAddresses(): void {
    const protocols: Array<[string, string, string[]]> = [
      ["0xdac17f958d2ee523a2206206994597c13d831ec7", "Tether USD", ["stablecoin", "erc20"]],
      ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USD Coin", ["stablecoin", "erc20"]],
      ["0x6b175474e89094c44da98b954eedeac495271d0f", "Dai", ["stablecoin", "erc20"]],
      ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "WETH", ["wrapped", "erc20"]],
      ["0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "Uniswap V2 Router", ["dex", "router"]],
      ["0xe592427a0aece92de3edee1f18e0157c05861564", "Uniswap V3 Router", ["dex", "router"]],
      ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "Uniswap Universal Router", ["dex", "router"]],
      ["0x1111111254eeb25477b68fb85ed929f73a960582", "1inch V5 Router", ["aggregator", "router"]],
      ["0x00000000006c3852cbef3e08e8df289169ede581", "Seaport 1.1", ["nft", "marketplace"]],
    ];

    for (const [addr, name, tags] of protocols) {
      this.entries.set(addr, {
        address: addr,
        label: name,
        isContract: true,
        isKnownScam: false,
        isKnownProtocol: true,
        riskLevel: "safe",
        tags,
      });
    }
  }

  loadFromSnapshot(contacts: Array<{ address: string; label: string; addedAt: number }>): void {
    this.contacts.clear();
    for (const contact of contacts) {
      this.contacts.set(contact.address.toLowerCase(), {
        label: contact.label,
        addedAt: contact.addedAt,
      });
    }
  }

  toSnapshot(): Array<{ address: string; label: string; addedAt: number }> {
    return this.listContacts();
  }
}
