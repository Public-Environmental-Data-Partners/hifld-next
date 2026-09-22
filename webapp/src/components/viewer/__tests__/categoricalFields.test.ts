import { describe, expect, it } from "vitest";
import { scalarFieldSummaries } from "../categoricalFields";

describe("categorical field metadata", () => {
  it("preserves authored values, types and numeric-looking text", () => {
    expect(scalarFieldSummaries({ zone: "String", code: "Number", open: "Boolean", geom: "object" }, [
      { name: "zone", type: "string", nullable: true, possible_values: ["01", "AE", "X"] },
      { name: "code", type: "int32", nullable: true, possible_values: ["0", "1"] },
    ])).toEqual([
      { name: "zone", type: "string", values: ["01", "AE", "X"] },
      { name: "code", type: "number", values: ["0", "1"] },
      { name: "open", type: "boolean", values: [] },
    ]);
  });

  it("does not offer metadata-only columns absent from the tile source", () => {
    expect(scalarFieldSummaries({ zone: "String" }, [
      { name: "secret", type: "string", nullable: true, possible_values: ["hidden"] },
    ])).toEqual([{ name: "zone", type: "string", values: [] }]);
  });
});
