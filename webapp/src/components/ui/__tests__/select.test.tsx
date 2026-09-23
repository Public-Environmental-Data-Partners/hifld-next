import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";

describe("long select menus", () => {
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
  afterAll(() => { HTMLElement.prototype.scrollIntoView = originalScroll; });
  it("uses a bounded popper instead of an expanding item-aligned menu", () => {
    render(
      <Select open defaultValue="0">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 35 }, (_, index) => (
            <SelectItem key={index} value={String(index)}>File {index}</SelectItem>
          ))}
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole("listbox")).toHaveAttribute("data-side");
    expect(screen.getByRole("listbox")).toHaveClass("max-h-[min(18rem,var(--radix-select-content-available-height))]");
    expect(screen.getAllByRole("option")).toHaveLength(35);
  });
});
