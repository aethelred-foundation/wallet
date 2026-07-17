import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

import { FormatProvider, useFormat } from "../popup/i18n/format";

afterEach(() => localStorage.clear());

function CurrencyProbe() {
  const format = useFormat();
  return (
    <div>
      <span data-testid="currency">{format.currency}</span>
      <span data-testid="amount">{format.formatCurrency(10)}</span>
    </div>
  );
}

describe("production currency formatting", () => {
  it("does not relabel USD-valued data as an unconverted currency", () => {
    localStorage.setItem("aethelred-currency", "EUR");

    render(
      <FormatProvider>
        <CurrencyProbe />
      </FormatProvider>,
    );

    expect(screen.getByTestId("currency")).toHaveTextContent("USD");
    expect(screen.getByTestId("amount").textContent).toMatch(/\$|US\$/);
  });
});
