import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "../pagination";

describe("Pagination", () => {
  it("renders crawlable hrefs and preserves client-side page changes", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <Pagination
        total={300}
        limit={100}
        offset={0}
        onPageChange={onPageChange}
        hrefForOffset={(nextOffset) => `/collections/hifld${nextOffset > 0 ? `?offset=${nextOffset}` : ""}`}
      />,
    );

    const nextLink = screen.getByRole("link", { name: "Next page" });
    expect(nextLink).toHaveAttribute("href", "/collections/hifld?offset=100");

    const pageTwoLink = screen.getByRole("link", { name: "Go to page 2" });
    expect(pageTwoLink).toHaveAttribute("href", "/collections/hifld?offset=100");

    await user.click(nextLink);
    expect(onPageChange).toHaveBeenCalledWith(100);
  });
});
