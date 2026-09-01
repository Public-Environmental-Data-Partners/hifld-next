import { describe, expect, it } from "vitest";
import {
  applyScale,
  buildColorExpression,
  computeQuantileBreaks,
  getColorRamp,
  getLegendItems,
  getValueRange,
} from "../src/index";

describe("map style helpers", () => {
  it("preserves all eight three-color palette outputs", () => {
    expect(getColorRamp("blues", 3)).toEqual(["#f7fbff", "#6baed6", "#08306b"]);
    expect(getColorRamp("greens", 3)).toEqual(["#f7fcf5", "#74c476", "#00441b"]);
    expect(getColorRamp("oranges", 3)).toEqual(["#fff5eb", "#fd8d3c", "#7f2704"]);
    expect(getColorRamp("purples", 3)).toEqual(["#fcfbfd", "#9e9ac8", "#3f007d"]);
    expect(getColorRamp("viridis", 3)).toEqual(["#440154", "#21918c", "#fde725"]);
    expect(getColorRamp("plasma", 3)).toEqual(["#0d0887", "#cc4778", "#f0f921"]);
    expect(getColorRamp("rdyblu", 3)).toEqual(["#a50026", "#ffffbf", "#313695"]);
    expect(getColorRamp("rdyg", 3)).toEqual(["#a50026", "#ffffbf", "#006837"]);
  });

  it("preserves color interpolation and fallback behavior", () => {
    expect(getColorRamp("blues", 5)).toEqual(["#f7fbff", "#b1d5eb", "#6baed6", "#3a6fa1", "#08306b"]);
    expect(getColorRamp("not-a-scheme", 1)).toEqual(["#440154", "#fde725"]);
  });

  it("preserves automatic quantile breaks and fallback intervals", () => {
    expect(computeQuantileBreaks([], 6)).toEqual([]);
    expect(computeQuantileBreaks([10, 20, 30, 40, 50, 60, 70], 3)).toEqual([20, 40, 50]);
    expect(computeQuantileBreaks([5, 5, 5], 3)).toEqual([6, 7, 8]);
    expect(computeQuantileBreaks([0, 40], 3)).toEqual([10, 20, 30]);
  });

  it("builds the current scale, value range, paint expression, and legend outputs", () => {
    expect(applyScale(-4, "sqrt")).toBe(0);
    expect(applyScale(0, "log")).toBe(Math.log(0.000001));
    expect(applyScale(5, "linear")).toBe(5);
    expect(getValueRange([])).toEqual({ min: 0, max: 0 });
    expect(getValueRange([6, -2, 9])).toEqual({ min: -2, max: 9 });
    expect(buildColorExpression("population", [10, 20], ["#111111", "#222222", "#333333"])).toEqual([
      "step",
      ["to-number", ["get", "population"]],
      "#111111",
      10,
      "#222222",
      20,
      "#333333",
    ]);
    expect(buildColorExpression(null, [10], [])).toBe("#C5E8FF");
    expect(getLegendItems([10, 20], ["#111111", "#222222", "#333333"])).toEqual([
      { label: "<= 10", color: "#111111" },
      { label: "10 - 20", color: "#222222" },
      { label: "> 20", color: "#333333" },
    ]);
  });
});
