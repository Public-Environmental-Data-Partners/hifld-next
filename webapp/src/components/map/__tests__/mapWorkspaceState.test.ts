import { describe, expect, it } from "vitest";
import { clearedLayerPickerSelection, layerPickerSelectionAfterLayerRemoval } from "../mapWorkspaceState";
import type { SourceDescriptor } from "../sourceDescriptors";

const descriptor: SourceDescriptor = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals",
  fileSlug: "hospitals",
  formatType: "pmtiles",
  storageLocationId: 4,
  version: "v1.0.0",
  sourceId: 15,
};

describe("map workspace state", () => {
  const selectedHospitals = {
    selectedDataset: { slug: "hospitals", name: "Hospitals" },
    selectedFileSlug: "hospitals",
    selectedVersion: "v1.0.0",
    selectedSourceId: "15",
  };

  it("clears the full layer picker selection after adding a layer", () => {
    expect(clearedLayerPickerSelection()).toEqual({
      selectedDataset: null,
      selectedFileSlug: undefined,
      selectedVersion: undefined,
      selectedSourceId: undefined,
    });
  });

  it("clears the full layer picker selection when removing its selected dataset layer", () => {
    expect(
      layerPickerSelectionAfterLayerRemoval({
        selection: selectedHospitals,
        removedLayerDescriptor: descriptor,
      }),
    ).toEqual(clearedLayerPickerSelection());
  });

  it("keeps the full layer picker selection when another dataset layer is removed", () => {
    const selectedSchools = {
      selectedDataset: { slug: "schools", name: "Schools" },
      selectedFileSlug: "schools",
      selectedVersion: "v2.0.0",
      selectedSourceId: "27",
    };

    expect(
      layerPickerSelectionAfterLayerRemoval({
        selection: selectedSchools,
        removedLayerDescriptor: descriptor,
      }),
    ).toBe(selectedSchools);
  });
});
