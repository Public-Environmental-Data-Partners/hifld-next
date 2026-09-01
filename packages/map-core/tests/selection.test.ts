import { describe, expect, it } from "vitest";
import {
  CLEAR_SELECTION_CONTROL_ARIA_LABEL,
  CLEAR_SELECTION_CONTROL_LABEL,
  ESRI_WORLD_IMAGERY_TILE_URL,
  MAX_SELECTED_FEATURES,
  OPENFREEMAP_BRIGHT_STYLE_URL,
  getBasemapControlLabel,
  getSelectionControlAriaLabel,
  getSelectionControlLabel,
  selectionBoxFeature,
  selectionScreenBounds,
} from "../src/index";

describe("map selection helpers", () => {
  it("preserves selection polygon winding", () => {
    expect(selectionBoxFeature({ lng: -77, lat: 39 }, { lng: -76, lat: 38 })).toEqual({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-77, 39],
            [-76, 39],
            [-76, 38],
            [-77, 38],
            [-77, 39],
          ],
        ],
      },
    });
  });

  it("normalizes reverse screen drags and retains the webapp cap", () => {
    expect(selectionScreenBounds({ x: 300, y: 10 }, { x: 20, y: 200 })).toEqual([
      [20, 10],
      [300, 200],
    ]);
    expect(MAX_SELECTED_FEATURES).toBe(100);
  });

  it("preserves basemap constants and current control labels", () => {
    expect(OPENFREEMAP_BRIGHT_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/bright");
    expect(ESRI_WORLD_IMAGERY_TILE_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    );
    expect(getSelectionControlLabel(false)).toBe("Highlight a region on the map. You can also hold Shift.");
    expect(getSelectionControlLabel(true)).toBe("Turn off region highlighting");
    expect(getSelectionControlAriaLabel(false)).toBe("Highlight a region");
    expect(getSelectionControlAriaLabel(true)).toBe("Turn off highlight region");
    expect(CLEAR_SELECTION_CONTROL_LABEL).toBe("Clear the highlighted region and selected features");
    expect(CLEAR_SELECTION_CONTROL_ARIA_LABEL).toBe("Clear highlighted region");
    expect(getBasemapControlLabel("street")).toBe("Switch to satellite imagery");
    expect(getBasemapControlLabel("satellite")).toBe("Switch to street map");
  });
});
