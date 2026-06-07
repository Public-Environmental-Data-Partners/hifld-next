import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS } from "../Header";

describe("Header", () => {
  it("includes a direct llms.txt navigation item", () => {
    expect(HEADER_NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        label: "llms.txt",
        href: "/llms.txt",
      }),
    );
  });
});
