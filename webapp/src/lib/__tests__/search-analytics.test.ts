import { describe, expect, it } from "vitest";
import { searchQueryForAnalytics } from "../search-analytics";

describe("search demand signals", () => {
  it.each([
    ["  Substations  ", "substations"],
    ["tribal broadband availability", "tribal broadband availability"],
    ["power plants 2010–2025", "power plants 2010–2025"],
    ["  water\nquality   Puerto Rico ", "water quality puerto rico"],
  ])("preserves discovery terms without a topic allowlist: %s", (input, expected) => {
    expect(searchQueryForAnalytics(input)).toBe(expected);
  });

  it.each([
    "", "   ", "x".repeat(201),
    "facilities near analyst@example.com", "https://private.example/data?token=secret",
    "call +1 (202) 555-0123", "123 Main Street", "38.897700, -77.036500",
  ])("omits text with obvious sensitive content or excessive length: %s", (input) => {
    expect(searchQueryForAnalytics(input)).toBeUndefined();
  });
});
