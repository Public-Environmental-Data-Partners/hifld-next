import { describe, expect, it } from "vitest";
import { initialMapDataPanelState, reduceMapDataPanelState } from "../mapDataPanelState";

describe("map data panel state", () => {
  it("opens query results and lets the same action collapse them", () => {
    const opened = reduceMapDataPanelState(initialMapDataPanelState, { type: "toggle_query_results" });
    expect(opened).toEqual({ isOpen: true, mode: "query" });
    expect(reduceMapDataPanelState(opened, { type: "toggle_query_results" })).toEqual({
      isOpen: false,
      mode: "query",
    });
  });

  it("switches an open selected-feature view back to query results", () => {
    expect(
      reduceMapDataPanelState({ isOpen: true, mode: "selected" }, { type: "toggle_query_results" }),
    ).toEqual({ isOpen: true, mode: "query" });
  });

  it("opens selected features when the map selection changes", () => {
    expect(reduceMapDataPanelState(initialMapDataPanelState, { type: "features_selected" })).toEqual({
      isOpen: true,
      mode: "selected",
    });
  });

  it("returns to query results after clearing selection when a query exists", () => {
    expect(
      reduceMapDataPanelState(
        { isOpen: true, mode: "selected" },
        { type: "features_cleared", hasQueryResults: true },
      ),
    ).toEqual({ isOpen: true, mode: "query" });
  });

  it("collapses after clearing selection when no query exists", () => {
    expect(
      reduceMapDataPanelState(
        { isOpen: true, mode: "selected" },
        { type: "features_cleared", hasQueryResults: false },
      ),
    ).toEqual({ isOpen: false, mode: "selected" });
  });

  it("supports explicit mode changes and panel collapse", () => {
    const selected = reduceMapDataPanelState({ isOpen: true, mode: "query" }, { type: "show_selected" });
    expect(selected).toEqual({ isOpen: true, mode: "selected" });
    expect(reduceMapDataPanelState(selected, { type: "collapse" })).toEqual({
      isOpen: false,
      mode: "selected",
    });
  });
});
