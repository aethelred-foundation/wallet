import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  ServicesProvider,
  useServices,
  useNetworkManager,
  usePortfolioManager,
  useAddressBook,
  useAddressBookContacts,
} from "../popup/services/services-context";

function ServiceProbe() {
  const networkManager = useNetworkManager();
  const portfolio = usePortfolioManager();
  const addressBook = useAddressBook();

  return (
    <div>
      <div data-testid="network">
        {networkManager ? "network-ok" : "network-missing"}
      </div>
      <div data-testid="portfolio">
        {portfolio && typeof portfolio.getTokens === "function"
          ? "portfolio-ok"
          : "portfolio-missing"}
      </div>
      <div data-testid="address-book">
        {addressBook ? "address-book-ok" : "address-book-missing"}
      </div>
    </div>
  );
}

function BareConsumer() {
  useServices();
  return <div>should-not-render</div>;
}

function ContactsProbe() {
  const contacts = useAddressBookContacts();
  return (
    <div data-testid="contacts-count">{contacts.length}</div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServicesProvider", () => {
  it("exposes networkManager, portfolio, and addressBook via hooks", () => {
    render(
      <ServicesProvider>
        <ServiceProbe />
      </ServicesProvider>,
    );

    expect(screen.getByTestId("network")).toHaveTextContent("network-ok");
    expect(screen.getByTestId("portfolio")).toHaveTextContent("portfolio-ok");
    expect(screen.getByTestId("address-book")).toHaveTextContent(
      "address-book-ok",
    );
  });

  it("useServices() throws outside of a ServicesProvider", () => {
    // Silence the expected React error-boundary noise during this render.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => render(<BareConsumer />)).toThrow(
      /must be used inside a <ServicesProvider>/,
    );

    errorSpy.mockRestore();
  });

  it("hydrates persisted contacts from the authoritative background", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "wallet-extension-id",
        lastError: undefined,
        sendMessage: vi.fn((message: { correlationId: string }, callback: (response: unknown) => void) => {
          callback({
            kind: "rpc-response",
            correlationId: message.correlationId,
            payload: {
              result: {
                contacts: [
                  {
                    label: "Treasury Vault",
                    address: "0x1111111111111111111111111111111111111111",
                    addedAt: Date.UTC(2026, 3, 15, 8, 0, 0),
                  },
                ],
                revision: 1,
              },
            },
            timestamp: Date.now(),
          });
        }),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });

    render(
      <ServicesProvider>
        <ContactsProbe />
      </ServicesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("contacts-count")).toHaveTextContent("1");
    });
  });

  it("defers recipient hydration while locked and accepts the unlock broadcast", async () => {
    const listeners = new Set<(message: {
      kind: string;
      payload: unknown;
    }) => void>();
    vi.stubGlobal("chrome", {
      runtime: {
        id: "wallet-extension-id",
        lastError: undefined,
        sendMessage: vi.fn((
          message: { correlationId: string },
          callback: (response: unknown) => void,
        ) => {
          callback({
            kind: "rpc-response",
            correlationId: message.correlationId,
            payload: {
              error: {
                code: 4100,
                message: "Unlock the wallet to view saved recipients",
              },
            },
            timestamp: Date.now(),
          });
        }),
        onMessage: {
          addListener: vi.fn((listener: (message: {
            kind: string;
            payload: unknown;
          }) => void) => listeners.add(listener)),
          removeListener: vi.fn((listener: (message: {
            kind: string;
            payload: unknown;
          }) => void) => listeners.delete(listener)),
        },
      },
    });

    render(
      <ServicesProvider>
        <ContactsProbe />
      </ServicesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("contacts-count")).toHaveTextContent("0");
    });

    act(() => {
      for (const listener of listeners) {
        listener({
          kind: "contacts-updated",
          payload: {
            contacts: [{
              label: "Treasury Vault",
              address: "0x1111111111111111111111111111111111111111",
              addedAt: Date.UTC(2026, 3, 15, 8, 0, 0),
            }],
            revision: 1,
          },
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("contacts-count")).toHaveTextContent("1");
    });
  });
});
