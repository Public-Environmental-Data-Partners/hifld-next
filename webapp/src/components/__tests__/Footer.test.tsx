import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Footer from "../Footer";

describe("Footer", () => {
  it("centers footer text and stacks footer links on small screens", () => {
    render(<Footer />);

    const footerCopy = screen
      .getByRole("link", { name: "Public Environmental Data Partners" })
      .closest("p");
    const feedbackLink = screen.getByRole("link", { name: "Share feedback" });
    const linkList = feedbackLink.closest("div");

    expect(footerCopy).toHaveClass("text-center", "sm:text-left");
    expect(linkList).toHaveClass("flex-col", "items-center", "sm:flex-row");
  });
});
