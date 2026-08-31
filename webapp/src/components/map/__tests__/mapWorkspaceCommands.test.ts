import { describe, expect, it } from "vitest";
import {
  assertValidAddDatasetLayer,
  assertValidCameraInput,
  assertValidLayerOrder,
  assertValidLayerStyleUpdate,
  assertValidLayerVisibility,
  type MapCameraInput,
  type MapLayerSummary,
} from "../mapWorkspaceCommands";

const layers: MapLayerSummary[] = [
  { id: "catalog:one", label: "One", kind: "catalog_pmtiles", visible: true },
  { id: "query:q-1", label: "Query", kind: "query_mvt", visible: true },
];

describe("map workspace command contracts", () => {
  it("validates layer mutations atomically", () => {
    expect(() => assertValidAddDatasetLayer({ layerId: "query:q-2", label: "Second query" }, layers)).not.toThrow();
    expect(() => assertValidAddDatasetLayer({ layerId: "catalog:one", label: "Duplicate" }, layers)).toThrow(
      /already loaded/,
    );
    expect(() => assertValidLayerVisibility("missing", true, layers)).toThrow(/does not exist/);
  });

  it("requires a complete, duplicate-free layer order", () => {
    expect(() => assertValidLayerOrder(["query:q-1", "catalog:one"], layers)).not.toThrow();
    expect(() => assertValidLayerOrder(["catalog:one"], layers)).toThrow(/exactly once/);
    expect(() => assertValidLayerOrder(["catalog:one", "catalog:one"], layers)).toThrow(/exactly once/);
  });

  it("allows only known fields, palettes, ranges, and scales in style updates", () => {
    const styleLayer = {
      id: "query:q-1:hifld",
      fields: ["beds"],
      numericFields: [{ name: "beds", min: 0, max: 100 }],
      geometryType: "Point",
    };
    expect(() =>
      assertValidLayerStyleUpdate(styleLayer, {
        colorProperty: "beds",
        colorScheme: "viridis",
        breaks: [20, 80],
        radiusScale: "sqrt",
        opacity: 0.5,
      }),
    ).not.toThrow();
    expect(() => assertValidLayerStyleUpdate(styleLayer, { colorProperty: "secret" })).toThrow(/unknown field/);
    expect(() => assertValidLayerStyleUpdate(styleLayer, { colorScheme: "rainbow" })).toThrow(/palette/);
    expect(() => assertValidLayerStyleUpdate(styleLayer, { breaks: [80, 20] })).toThrow(/increasing/);
    expect(() => assertValidLayerStyleUpdate(styleLayer, { radiusScale: "step" })).toThrow(/scale/);
    expect(() => assertValidLayerStyleUpdate(styleLayer, { opacity: 2 })).toThrow(/opacity/);
    const rawExpressionUpdate = { expression: ["get", "beds"] };
    expect(() => assertValidLayerStyleUpdate(styleLayer, rawExpressionUpdate)).toThrow(
      /unsupported style field/,
    );
  });

  it("accepts exactly one camera target form", () => {
    const center: MapCameraInput = { target: { center: [-77, 39], zoom: 8 } };
    expect(() => assertValidCameraInput(center)).not.toThrow();
    expect(() => assertValidCameraInput({ target: { bounds: [-78, 38, -76, 40] } })).not.toThrow();
    expect(() =>
      assertValidCameraInput({
        target: { center: [-77, 39], zoom: 8, bounds: [-78, 38, -76, 40] },
      }),
    ).toThrow(/exactly one/);
    expect(() => assertValidCameraInput({ target: {} })).toThrow(/exactly one/);
  });
});
