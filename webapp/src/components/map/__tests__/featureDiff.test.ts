import { describe, expect, it } from "vitest";
import {
  buildFeatureDiff,
  changedFeatureDiffColumns,
  defaultFeatureDiffMatchKeyPairs,
  GEOMETRY_MATCH_COLUMN,
  isComparableFeatureDiffSelection,
} from "../featureDiff";
import { s2CellForPoint } from "../featureSpatialIndex";
import type { SelectedFeatureProperties, SelectedMapFeature } from "../featureSelection";

function selectedFeature({
  id,
  version,
  properties,
  lng,
  lat,
  fileSlug = "hospitals-3",
}: {
  id: string;
  version: string;
  properties: SelectedFeatureProperties;
  lng: number;
  lat: number;
  fileSlug?: string;
}): SelectedMapFeature {
  return {
    id,
    loadedLayerId: `layer-${version}`,
    layerName: `Hospitals / ${version}`,
    collectionSlug: "hifld",
    datasetSlug: "hospitals-3",
    fileSlug,
    version,
    sourceId: version === "v1.0.0" ? 15 : 17,
    sourceLayerId: "hospitals-3",
    featureId: id,
    centroid: { lng, lat },
    properties,
  };
}

describe("feature diff helpers", () => {
  it("only allows diffing exactly two versions of the same dataset file", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "100" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "100" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const unrelated = selectedFeature({
      id: "other-1",
      version: "v1.1.0",
      properties: { OBJECTID: "100" },
      lng: -77.0365,
      lat: 38.8977,
      fileSlug: "urgent-care",
    });

    expect(isComparableFeatureDiffSelection([left, right])).toBe(true);
    expect(isComparableFeatureDiffSelection([left])).toBe(false);
    expect(isComparableFeatureDiffSelection([left, unrelated])).toBe(false);
  });

  it("chooses default match key pairs from common stable identifiers before geometry", () => {
    const withObjectId = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "100", NAME: "General Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const withNameOnly = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { NAME: "General Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const withGeometryOnly = selectedFeature({
      id: "right-2",
      version: "v1.1.0",
      properties: {},
      lng: -77.0365,
      lat: 38.8977,
    });

    expect(defaultFeatureDiffMatchKeyPairs([withObjectId], "v1.0.0", "v1.0.0")).toEqual([
      { id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" },
    ]);
    expect(defaultFeatureDiffMatchKeyPairs([withNameOnly], "v1.1.0", "v1.1.0")).toEqual([
      { id: "NAME:NAME", left: "NAME", right: "NAME" },
    ]);
    expect(defaultFeatureDiffMatchKeyPairs([withGeometryOnly], "v1.1.0", "v1.1.0")).toEqual([
      { id: `${GEOMETRY_MATCH_COLUMN}:${GEOMETRY_MATCH_COLUMN}`, left: GEOMETRY_MATCH_COLUMN, right: GEOMETRY_MATCH_COLUMN },
    ]);
  });

  it("matches with different selected keys on each version", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OLD_ID: "100", NAME: "Northside Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { NEW_ID: "100", NAME: "Northside Hospital Campus" },
      lng: -77.036,
      lat: 38.898,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "OLD_ID:NEW_ID", left: "OLD_ID", right: "NEW_ID" }],
      s2Level: 16,
    });

    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({ status: "changed", matchMethod: "key", confidence: 1 });
  });

  it("pairs rows by selected fuzzy text columns and reports side-by-side cell statuses", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { NAME: "Northside Hospital", BEDS: "10", CLOSED: "Y" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { NAME: "Northside Hospital Campus", BEDS: "12", OPENED: "Y" },
      lng: -77.036,
      lat: 38.898,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "NAME:NAME", left: "NAME", right: "NAME" }],
      s2Level: 16,
    });

    expect(diff.canCompare).toBe(true);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({
      status: "possible match",
      matchMethod: "fuzzy",
    });
    expect(diff.rows[0]?.cells.BEDS).toMatchObject({ status: "changed", left: "10", right: "12" });
    expect(diff.rows[0]?.cells.CLOSED).toMatchObject({ status: "removed", left: "Y", right: "" });
    expect(diff.rows[0]?.cells.OPENED).toMatchObject({ status: "added", left: "", right: "Y" });
  });

  it("distinguishes absent properties from present empty and zero values", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", EMPTY: "", ZERO: "0", REMOVED_EMPTY: "" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "1", EMPTY: "", ZERO: "0", ADDED_EMPTY: "" },
      lng: -77.0365,
      lat: 38.8977,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" }],
      s2Level: 16,
    });

    expect(diff.rows[0]?.cells.EMPTY).toMatchObject({
      status: "unchanged",
      leftPresent: true,
      rightPresent: true,
      left: "",
      right: "",
    });
    expect(diff.rows[0]?.cells.ZERO).toMatchObject({
      status: "unchanged",
      leftPresent: true,
      rightPresent: true,
      left: "0",
      right: "0",
    });
    expect(diff.rows[0]?.cells.REMOVED_EMPTY).toMatchObject({
      status: "removed",
      leftPresent: true,
      rightPresent: false,
      left: "",
      right: "",
    });
    expect(diff.rows[0]?.cells.ADDED_EMPTY).toMatchObject({
      status: "added",
      leftPresent: false,
      rightPresent: true,
      left: "",
      right: "",
    });
  });

  it("requires selected stable keys to agree instead of allowing one matching key to win", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "2", NAME: "Northside Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [
        { id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" },
        { id: "NAME:NAME", left: "NAME", right: "NAME" },
      ],
      s2Level: 16,
    });

    expect(diff.rows.map((row) => row.status)).toEqual(["left only", "right only"]);
  });

  it("uses aggregate agreement across selected keys to match changed rows", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital", BEDS: "10" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital Campus", BEDS: "12" },
      lng: -77.0365,
      lat: 38.8977,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [
        { id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" },
        { id: "NAME:NAME", left: "NAME", right: "NAME" },
      ],
      s2Level: 16,
    });

    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({ status: "changed", matchMethod: "key" });
  });

  it("prefers exact stable-key candidates over fuzzy duplicate candidates", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const fuzzyRight = selectedFeature({
      id: "right-fuzzy",
      version: "v1.1.0",
      properties: { OBJECTID: "2", NAME: "Northside Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const exactRight = selectedFeature({
      id: "right-exact",
      version: "v1.1.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital Campus" },
      lng: -77.036,
      lat: 38.898,
    });

    const diff = buildFeatureDiff([left, fuzzyRight, exactRight], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [
        { id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" },
        { id: "NAME:NAME", left: "NAME", right: "NAME" },
      ],
      s2Level: 16,
    });

    expect(diff.rows.find((row) => row.left?.id === "left-1")?.right?.id).toBe("right-exact");
  });

  it("reports changed columns in source order", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital", BEDS: "10" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "1", NAME: "Northside Hospital", BEDS: "12" },
      lng: -77.0365,
      lat: 38.8977,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" }],
      s2Level: 16,
    });

    expect(changedFeatureDiffColumns(diff).map((column) => column.key)).toEqual(["BEDS"]);
  });

  it("uses selected geometry to match nearby rows with S2", () => {
    const left = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { NAME: "North Hospital" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const right = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { NAME: "North Hospital Campus" },
      lng: -77.03651,
      lat: 38.89771,
    });

    const diff = buildFeatureDiff([left, right], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "geometry:geometry", left: GEOMETRY_MATCH_COLUMN, right: GEOMETRY_MATCH_COLUMN }],
      s2Level: 16,
    });

    expect(diff.rows[0]).toMatchObject({
      status: "possible match",
      matchMethod: "s2",
    });
    expect(diff.summary.possibleMatches).toBe(1);
  });

  it("sorts rows by status, confidence, and property columns", () => {
    const leftChanged = selectedFeature({
      id: "left-1",
      version: "v1.0.0",
      properties: { OBJECTID: "1", NAME: "Beta", BEDS: "10" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const rightChanged = selectedFeature({
      id: "right-1",
      version: "v1.1.0",
      properties: { OBJECTID: "1", NAME: "Beta", BEDS: "12" },
      lng: -77.0365,
      lat: 38.8977,
    });
    const leftUnchanged = selectedFeature({
      id: "left-2",
      version: "v1.0.0",
      properties: { OBJECTID: "2", NAME: "Alpha", BEDS: "8" },
      lng: -78,
      lat: 39,
    });
    const rightUnchanged = selectedFeature({
      id: "right-2",
      version: "v1.1.0",
      properties: { OBJECTID: "2", NAME: "Alpha", BEDS: "8" },
      lng: -78,
      lat: 39,
    });

    const byName = buildFeatureDiff([leftChanged, rightChanged, leftUnchanged, rightUnchanged], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" }],
      s2Level: 16,
      sort: { column: "NAME", direction: "asc" },
    });
    const byStatus = buildFeatureDiff([leftChanged, rightChanged, leftUnchanged, rightUnchanged], {
      leftVersion: "v1.0.0",
      rightVersion: "v1.1.0",
      matchKeyPairs: [{ id: "OBJECTID:OBJECTID", left: "OBJECTID", right: "OBJECTID" }],
      s2Level: 16,
      sort: { column: "status", direction: "asc" },
    });

    expect(byName.rows.map((row) => row.cells.NAME?.left)).toEqual(["Alpha", "Beta"]);
    expect(byStatus.rows.map((row) => row.status)).toEqual(["changed", "unchanged"]);
  });
});

describe("feature spatial index", () => {
  it("returns stable S2 tokens and neighbors for a point", () => {
    const cell = s2CellForPoint({ lng: -77.0365, lat: 38.8977 }, 16);

    expect(cell.level).toBe(16);
    expect(cell.token.length).toBeGreaterThan(0);
    expect(cell.neighbors).toContain(cell.token);
    expect(cell.neighbors.length).toBeGreaterThan(1);
  });
});
