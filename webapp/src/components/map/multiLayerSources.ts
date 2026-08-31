import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import type { Dataset, DatasetFile, DatasetSource, SpatialDatasetFileMetadata } from "@/lib/api-client";
import type { SourceDescriptor } from "./sourceDescriptors";
import { sourceDescriptorId } from "./sourceDescriptors";

export type MapBounds = [minX: number, minY: number, maxX: number, maxY: number];

interface MapLayerBase {
  id: string;
  name: string;
  label: string;
  datasetName?: string | undefined;
  storageLocationName?: string | undefined;
  mapSourceId: string;
  visible: boolean;
  opacity: number;
  bounds: MapBounds | null;
}

export interface CatalogPmtilesLayer extends MapLayerBase {
  kind: "catalog_pmtiles";
  descriptor: SourceDescriptor;
  sourceMetadata?: SpatialDatasetFileMetadata | undefined;
  pmtilesUrl: string;
}

export interface QueryScalarFieldMetadata {
  name: string;
  logicalType: string;
  nullable: boolean;
  min?: number | undefined;
  max?: number | undefined;
}

export type QueryMapLayerStatus = "loading" | "ready" | "error";

export interface QueryMvtLayer extends MapLayerBase {
  kind: "query_mvt";
  queryId: string;
  sourceAliases: string[];
  geometryColumn: string;
  tileTemplate: string;
  sourceLayerId: string;
  scalarFields: QueryScalarFieldMetadata[];
  status: QueryMapLayerStatus;
}

export type LoadedMapLayer = CatalogPmtilesLayer | QueryMvtLayer;

function boundsFromMetadata(metadata: SpatialDatasetFileMetadata | undefined): MapBounds | null {
  const bounds = metadata?.bounds;
  if (!bounds || bounds.length !== 4 || bounds.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bounds;
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return [minX, minY, maxX, maxY];
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
  sourceMetadata,
}: {
  descriptor: SourceDescriptor;
  name: string;
  datasetName?: string | undefined;
  storageLocationName?: string | undefined;
  pmtilesUrl: string;
  sourceMetadata?: SpatialDatasetFileMetadata | undefined;
}): CatalogPmtilesLayer {
  const id = sourceDescriptorId(descriptor);
  return {
    kind: "catalog_pmtiles",
    id,
    name,
    label: name,
    datasetName,
    storageLocationName,
    descriptor,
    sourceMetadata,
    pmtilesUrl,
    mapSourceId: `source-${id}`,
    visible: true,
    opacity: 0.82,
    bounds: boundsFromMetadata(sourceMetadata),
  };
}

export interface QueryMvtLayerInput {
  queryId: string;
  label: string;
  sourceAliases: readonly string[];
  geometryColumn: string;
  tileTemplate: string;
  sourceLayerId?: string | undefined;
  scalarFields?: readonly QueryScalarFieldMetadata[] | undefined;
  bounds?: MapBounds | null | undefined;
  status?: QueryMapLayerStatus | undefined;
}

export function buildQueryMvtLayer(input: QueryMvtLayerInput): QueryMvtLayer {
  const queryId = input.queryId.trim();
  const label = input.label.trim();
  if (!queryId) {
    throw new Error("queryId must not be empty");
  }
  if (!label) {
    throw new Error("query layer label must not be empty");
  }
  if (!input.geometryColumn.trim()) {
    throw new Error("query geometry column must not be empty");
  }
  if (!input.tileTemplate.trim()) {
    throw new Error("query tile template must not be empty");
  }
  const sourceLayerId = input.sourceLayerId?.trim() || "hifld";
  return {
    kind: "query_mvt",
    id: `query:${queryId}`,
    name: label,
    label,
    queryId,
    sourceAliases: [...input.sourceAliases],
    geometryColumn: input.geometryColumn,
    tileTemplate: input.tileTemplate,
    sourceLayerId,
    scalarFields: [...(input.scalarFields ?? [])],
    bounds: input.bounds ?? null,
    status: input.status ?? "loading",
    mapSourceId: `source-query-${queryId}`,
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
