import type { BasemapMode } from "./basemap";

export const CLEAR_SELECTION_CONTROL_LABEL = "Clear the highlighted region and selected features";
export const CLEAR_SELECTION_CONTROL_ARIA_LABEL = "Clear highlighted region";

export function getSelectionControlLabel(isSelectionActive: boolean): string {
  return isSelectionActive ? "Turn off region highlighting" : "Highlight a region on the map. You can also hold Shift.";
}

export function getSelectionControlAriaLabel(isSelectionActive: boolean): string {
  return isSelectionActive ? "Turn off highlight region" : "Highlight a region";
}

export function getBasemapControlLabel(basemapMode: BasemapMode): string {
  return basemapMode === "satellite" ? "Switch to street map" : "Switch to satellite imagery";
}
