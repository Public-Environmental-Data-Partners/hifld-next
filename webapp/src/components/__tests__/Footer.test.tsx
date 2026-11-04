import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Footer from "../Footer";

describe("Footer", () => {
  it("left-aligns footer text and stacks footer links on small screens", () => {
    render(<Footer />);

    const footerCopy = screen
      .getByRole("link", { name: "Public Environmental Data Partners" })
      .closest("p");
    const feedbackLink = screen.getByRole("link", { name: "Share feedback" });
    const linkList = feedbackLink.closest("div");

    expect(footerCopy).toHaveClass("text-sm", "text-muted-foreground");
    expect(footerCopy).not.toHaveClass("text-center");
    expect(linkList).toHaveClass("flex-col", "items-start", "sm:flex-row", "sm:items-center");
  });
});

it("links privacy information and remembers an explicit analytics opt-out", async () => {
 const {fireEvent} = await import("@testing-library/react");
 render(<Footer />);
 expect(screen.getByRole("link", {name:"Privacy & analytics"})).toHaveAttribute("href", "/privacy");
 fireEvent.click(screen.getByRole("button", {name:"Turn off analytics"}));
 expect(document.cookie).toContain("hifld_analytics=off");
 expect(screen.getByRole("button", {name:"Turn on analytics"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", {name:"Turn on analytics"}));
 expect(document.cookie).not.toContain("hifld_analytics=off");
});
