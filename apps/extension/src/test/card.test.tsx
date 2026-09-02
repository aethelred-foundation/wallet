import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../popup/components/card";

describe("Card", () => {
  it("renders a non-interactive surface as a div with tokenized defaults", () => {
    render(<Card>Production status</Card>);

    const card = screen.getByText("Production status");
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("ui-card", "ui-card-solid");
    expect(card).not.toHaveAttribute("type");
    expect(card).toHaveStyle({
      padding: "var(--space-3)",
      boxShadow: "var(--shadow-1)",
    });
  });
});
