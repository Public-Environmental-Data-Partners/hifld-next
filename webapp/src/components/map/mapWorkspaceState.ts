import type { SourceDescriptor } from "./sourceDescriptors";

export interface LayerPickerDataset {
  slug: string;
}

export interface LayerPickerSelection<TDataset extends LayerPickerDataset> {
  selectedDataset: TDataset | null;
  selectedFileSlug: string | undefined;
  selectedVersion: string | undefined;
  selectedSourceId: string | undefined;
}

export function clearedLayerPickerSelection<TDataset extends LayerPickerDataset>(): LayerPickerSelection<TDataset> {
  return {
    selectedDataset: null,
    selectedFileSlug: undefined,
    selectedVersion: undefined,
    selectedSourceId: undefined,
  };
}

export function layerPickerSelectionAfterLayerRemoval<TDataset extends LayerPickerDataset>({
  selection,
  removedLayerDescriptor,
}: {
  selection: LayerPickerSelection<TDataset>;
  removedLayerDescriptor: SourceDescriptor;
}): LayerPickerSelection<TDataset> {
  if (selection.selectedDataset?.slug !== removedLayerDescriptor.datasetSlug) {
    return selection;
  }
  return clearedLayerPickerSelection();
}
