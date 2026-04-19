import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  ServicesProvider,
  useServices,
  useNetworkManager,
  usePortfolioManager,
  useAddressBook,
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
  const addressBook = useAddressBook();
  return (
    <div data-testid="contacts-count">{addressBook.listContacts().length}</div>
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

  it("hydrates persisted contacts from extension storage", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn((key: string, callback: (value: Record<string, string>) => void) => {
            callback({
              [key]: JSON.stringify({
                contacts: [
                  {
                    label: "Treasury Vault",
                    address: "0x1111111111111111111111111111111111111111",
                    addedAt: Date.UTC(2026, 3, 15, 8, 0, 0),
                  },
                ],
              }),
            });
          }),
          set: vi.fn((_: unknown, callback: () => void) => callback()),
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
});
