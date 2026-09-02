export type MapDataPanelMode = "query" | "selected";

export interface MapDataPanelState {
  isOpen: boolean;
  mode: MapDataPanelMode;
}

export type MapDataPanelEvent =
  | { type: "toggle_query_results" }
  | { type: "features_selected" }
  | { type: "features_cleared"; hasQueryResults: boolean }
  | { type: "show_query" }
  | { type: "show_selected" }
  | { type: "collapse" };

export const initialMapDataPanelState: MapDataPanelState = {
  isOpen: false,
  mode: "query",
};

export function reduceMapDataPanelState(state: MapDataPanelState, event: MapDataPanelEvent): MapDataPanelState {
  switch (event.type) {
    case "toggle_query_results":
      return state.isOpen && state.mode === "query" ? { ...state, isOpen: false } : { isOpen: true, mode: "query" };
    case "features_selected":
    case "show_selected":
      return { isOpen: true, mode: "selected" };
    case "features_cleared":
      return event.hasQueryResults ? { isOpen: true, mode: "query" } : { isOpen: false, mode: "selected" };
    case "show_query":
      return { isOpen: true, mode: "query" };
    case "collapse":
      return { ...state, isOpen: false };
  }
}
