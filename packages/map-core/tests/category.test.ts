import { describe, expect, it } from "vitest";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  categoricalStyle,
  chooseLayerPalette,
  colorSchemes,
  extendCategoryRegistry,
  solidPaletteColor,
  type CategoryRegistry,
} from "../src/index";

describe("category registries", () => {
  it("normalizes and deterministically appends only unseen values", () => {
    const initial: CategoryRegistry = { values: [2], overflow: false };
    const extended = extendCategoryRegistry(initial, ["10", 1, "2", 1], "number");
    expect(extended).toEqual({ values: [2, 1, 10], overflow: false });
    expect(extendCategoryRegistry(extended, [10, "1"], "number")).toBe(extended);
  });

  it("preserves text exactly and normalizes boolean strings", () => {
    expect(extendCategoryRegistry({ values: [], overflow: false }, ["a", "01", "A", ""], "string")).toEqual({
      values: ["01", "A", "a"],
      overflow: false,
    });
    expect(extendCategoryRegistry({ values: [], overflow: false }, ["false", true, "true"], "boolean")).toEqual({
      values: [false, true],
      overflow: false,
    });
  });

  it("caps explicit entries at 32 and remembers overflow without reallocating", () => {
    const values = Array.from({ length: 35 }, (_, index) => index);
    const registry = extendCategoryRegistry({ values: [], overflow: false }, values, "number");
    expect(registry.values).toHaveLength(32);
    expect(registry.overflow).toBe(true);
    expect(extendCategoryRegistry(registry, [34], "number")).toBe(registry);
  });
});

describe("categorical styles", () => {
  function evaluate(color: ReturnType<typeof categoricalStyle>["color"], properties: Record<string, string | number | boolean | null>): string {
    const parsed = createExpression(color);
    if (parsed.result !== "success") {
      throw new Error(parsed.value.map((error) => `${error.key}: ${error.message}`).join("; "));
    }
    return parsed.value.evaluate({ zoom: 0 }, { type: 1, properties }) as string;
  }

  it("uses stable fixed palette slots and keeps map colors aligned with legend colors", () => {
    const registry: CategoryRegistry = { values: ["Floodway", "A", "01"], overflow: false };
    const style = categoricalStyle("zone", registry, "string", "tableau10");
    expect(style.items.slice(0, 3)).toEqual([
      { label: "Floodway", color: "#4e79a7" },
      { label: "A", color: "#f28e2b" },
      { label: "01", color: "#e15759" },
    ]);
    expect(style.color).toEqual([
      "case",
      [
        "any",
        ["!", ["has", "zone"]],
        ["==", ["get", "zone"], null],
        ["==", ["to-string", ["get", "zone"]], ""],
      ],
      "#d1d5db",
      [
        "match",
        ["to-string", ["get", "zone"]],
        "Floodway",
        "#4e79a7",
        "A",
        "#f28e2b",
        "01",
        "#e15759",
        "#6b7280",
      ],
    ]);
    expect(style.items.slice(-2)).toEqual([
      { label: "Other values", color: "#6b7280" },
      { label: "No data", color: "#d1d5db" },
    ]);
  });

  it("matches numeric strings to typed numbers and treats zero as data", () => {
    const registry = extendCategoryRegistry({ values: [], overflow: false }, ["0", "2"], "number");
    const style = categoricalStyle("code", registry, "number", "set3");
    expect(style.items[0]).toEqual({ label: "0", color: "#8dd3c7" });
    expect(style.color).toEqual([
      "case",
      [
        "any",
        ["!", ["has", "code"]],
        ["==", ["get", "code"], null],
        ["==", ["to-string", ["get", "code"]], ""],
      ],
      "#d1d5db",
      [
        "match",
        ["to-string", ["to-number", ["get", "code"], Number.MIN_SAFE_INTEGER]],
        "0",
        "#8dd3c7",
        "2",
        "#ffffb3",
        "#6b7280",
      ],
    ]);
  });

  it("normalizes booleans to strings so false remains a category", () => {
    const registry: CategoryRegistry = { values: [false, true], overflow: false };
    const style = categoricalStyle("active", registry, "boolean", "tableau10");
    expect(style.items.slice(0, 2).map((item) => item.label)).toEqual(["false", "true"]);
    expect(style.color).toEqual([
      "case",
      [
        "any",
        ["!", ["has", "active"]],
        ["==", ["get", "active"], null],
        ["==", ["to-string", ["get", "active"]], ""],
      ],
      "#d1d5db",
      [
        "match",
        ["downcase", ["to-string", ["get", "active"]]],
        "false",
        "#4e79a7",
        "true",
        "#f28e2b",
        "#6b7280",
      ],
    ]);
  });

  it("reports category caps and reused fixed swatches", () => {
    const registry: CategoryRegistry = {
      values: Array.from({ length: 32 }, (_, index) => `value-${index}`),
      overflow: true,
    };
    const style = categoricalStyle("kind", registry, "string", "tableau10");
    expect(style.notes).toEqual([
      "Showing the first 32 categories; additional categories use Other values.",
      "Palette colors are reused for some categories.",
    ]);
    expect(style.items[10]?.color).toBe(style.items[0]?.color);
  });

  it("produces a valid expression for an empty registry", () => {
    const style = categoricalStyle("kind", { values: [], overflow: false }, "string", "tableau10");
    expect(evaluate(style.color, { kind: "anything" })).toBe("#6b7280");
    expect(evaluate(style.color, {})).toBe("#d1d5db");
  });

  it("evaluates numeric categories without errors for decimals or unexpected values", () => {
    const registry = extendCategoryRegistry({ values: [], overflow: false }, ["1.25", 2], "number");
    const style = categoricalStyle("code", registry, "number", "set3");
    expect(evaluate(style.color, { code: 1.25 })).toBe("#8dd3c7");
    expect(evaluate(style.color, { code: "1.25" })).toBe("#8dd3c7");
    expect(evaluate(style.color, { code: "unexpected" })).toBe("#6b7280");
    expect(evaluate(style.color, { code: true })).toBe("#6b7280");
    expect(evaluate(style.color, { code: 0 })).toBe("#6b7280");
    expect(evaluate(style.color, { code: null })).toBe("#d1d5db");
    expect(evaluate(style.color, { code: "" })).toBe("#d1d5db");
  });
});

describe("palette helpers", () => {
  it("adds qualitative schemes without changing the palette order used for allocation", () => {
    expect(colorSchemes.slice(-2).map((scheme) => scheme.id)).toEqual(["tableau10", "set3"]);
    expect(chooseLayerPalette([])).toBe("viridis");
    expect(chooseLayerPalette(["viridis"])).toBe("plasma");
  });

  it("chooses the least-used palette with fixed tie breaking after exhaustion", () => {
    const once = ["viridis", "plasma", "blues", "greens", "oranges", "purples", "rdyblu", "rdyg", "tableau10", "set3"];
    expect(chooseLayerPalette([...once, "viridis"])).toBe("plasma");
    expect(chooseLayerPalette([...once, "made-up"])).toBe("viridis");
  });

  it("returns visible representative solid colors", () => {
    expect(solidPaletteColor("viridis")).toBe("#21918c");
    expect(solidPaletteColor("tableau10")).toBe("#4e79a7");
    expect(solidPaletteColor("rdyblu")).toBe("#313695");
    expect(solidPaletteColor("rdyg")).toBe("#006837");
    expect(solidPaletteColor("not-a-scheme")).toBe("#21918c");
  });
});
