import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownDescription } from "../MarkdownDescription";

describe("MarkdownDescription", () => {
  it("renders markdown links and constrained images", () => {
    render(
      <MarkdownDescription
        markdown={
          "Updated bed counts. Provided by [Niyam IT](https://niyamit.com).\n\n![Niyam IT logo](https://niyamit.com/logo.png)"
        }
      />,
    );

    const link = screen.getByRole("link", { name: "Niyam IT" });
    expect(link).toHaveAttribute("href", "https://niyamit.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const logo = screen.getByRole("img", { name: "Niyam IT logo" });
    expect(logo).toHaveAttribute("src", "https://niyamit.com/logo.png");
    expect(logo).toHaveClass("max-h-10");
  });

  it("renders plain text descriptions", () => {
    render(<MarkdownDescription markdown="Updated bed counts. Provided by Niyam IT" />);

    expect(screen.getByText("Updated bed counts. Provided by Niyam IT")).toBeInTheDocument();
  });

  it("does not render raw html or unsafe urls", () => {
    render(
      <MarkdownDescription
        markdown={
          '<script>alert("xss")</script><img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[plain http](http://example.com)\n\n![http image](http://example.com/logo.png)'
        }
      />,
    );

    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("bad")).not.toHaveAttribute("href");
    expect(screen.getByText("plain http")).not.toHaveAttribute("href");
  });
});
