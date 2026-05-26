import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import type { Dataset, DatasetFile, DatasetSource } from "@/lib/api-client";
import type { SourceDescriptor } from "./sourceDescriptors";
import { sourceDescriptorId } from "./sourceDescriptors";

export interface LoadedMapLayer {
  id: string;
  name: string;
  datasetName?: string | undefined;
  storageLocationName?: string | undefined;
  descriptor: SourceDescriptor;
  pmtilesUrl: string;
  mapSourceId: string;
  visible: boolean;
  opacity: number;
}

export interface LoadedTableSource {
  id: string;
  label: string;
  url: string;
  fileName: string;
}

export interface HighlightedFeatureRow {
  id: string;
  layerLabel: string;
  values: Array<[string, string]>;
}

export function buildLoadedMapLayer({
  descriptor,
  name,
  datasetName,
  storageLocationName,
  pmtilesUrl,
}: {
  descriptor: SourceDescriptor;
  name: string;
  datasetName?: string | undefined;
  storageLocationName?: string | undefined;
  pmtilesUrl: string;
}): LoadedMapLayer {
  const id = sourceDescriptorId(descriptor);
  return {
    id,
    name,
    datasetName,
    storageLocationName,
    descriptor,
    pmtilesUrl,
    mapSourceId: `source-${id}`,
    visible: true,
    opacity: 0.82,
  };
}

export function tableSourceFromDatasetSource({
  dataset,
  file,
  source,
}: {
  dataset: Dataset;
  file: DatasetFile;
  source: DatasetSource;
}): LoadedTableSource | null {
  const url = buildSourceFileUrl(source);
  if (!url || url.includes("*")) {
    return null;
  }
  return {
    id: String(source.id),
    label: `${dataset.name} / ${file.name} / ${source.version ?? "1"}`,
    url,
    fileName: `${file.slug}-${source.version ?? source.id}.parquet`,
  };
}
