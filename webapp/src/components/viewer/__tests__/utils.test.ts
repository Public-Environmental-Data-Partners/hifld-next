import { describe, expect, it } from "vitest";
import {
  automaticBreaksForNumericField,
  computeEqualIntervalBreaks,
  computeQuantileBreaks,
  getColorRamp,
} from "../utils";

describe("viewer style utilities", () => {
  it("keeps the current endpoints for all eight color palettes", () => {
    expect(getColorRamp("blues", 2)).toEqual(["#f7fbff", "#08306b"]);
    expect(getColorRamp("greens", 2)).toEqual(["#f7fcf5", "#00441b"]);
    expect(getColorRamp("oranges", 2)).toEqual(["#fff5eb", "#7f2704"]);
    expect(getColorRamp("purples", 2)).toEqual(["#fcfbfd", "#3f007d"]);
    expect(getColorRamp("viridis", 2)).toEqual(["#440154", "#fde725"]);
    expect(getColorRamp("plasma", 2)).toEqual(["#0d0887", "#f0f921"]);
    expect(getColorRamp("rdyblu", 2)).toEqual(["#a50026", "#313695"]);
    expect(getColorRamp("rdyg", 2)).toEqual(["#a50026", "#006837"]);
  });

  it("does not invent breakpoints when no numeric samples are available", () => {
    expect(computeQuantileBreaks([], 6)).toEqual([]);
  });

  it("computes deterministic equal interval breakpoints from metadata ranges", () => {
    expect(computeEqualIntervalBreaks(0, 70, 6)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("uses sampled values for automatic breakpoints when metadata ranges are missing", () => {
    expect(
      automaticBreaksForNumericField({
        field: { name: "population" },
        sampledValues: [10, 20, 30, 40, 50, 60, 70],
        count: 3,
      }),
    ).toEqual([20, 40, 50]);
  });

  it("uses sampled values before metadata ranges for automatic breakpoints", () => {
    expect(
      automaticBreaksForNumericField({
        field: { name: "beds", min: -999, max: 2059 },
        sampledValues: [10, 20, 25, 30, 40, 50, 80],
        count: 3,
      }),
    ).toEqual([20, 30, 40]);
  });

  it("falls back to metadata ranges when no sampled values are available", () => {
    expect(
      automaticBreaksForNumericField({
        field: { name: "population", min: 0, max: 40 },
        sampledValues: [],
        count: 3,
      }),
    ).toEqual([10, 20, 30]);
  });
});
