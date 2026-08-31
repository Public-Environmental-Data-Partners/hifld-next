import { useCallback } from "react";
import { z } from "zod";
import type {
  DatasetLayerInput,
  LayerStyleUpdate,
  MapCameraInput,
  MapCameraState,
  MapWorkspaceCommands,
} from "@/components/map/mapWorkspaceCommands";
import { MapWorkspaceCommandError } from "@/components/map/mapWorkspaceCommands";
import { failure, success, type WebMcpJsonObject, type WebMcpResult } from "./result";
import { useWebMcpTool } from "./useWebMcpTool";

const mapLayerIdSchema = z.string().min(1).max(200);
const styleLayerIdSchema = z.string().min(1).max(200);
const emptyInputSchema = z.object({}).strict();
const palette = ["blues", "greens", "oranges", "purples", "viridis", "plasma", "rdyblu", "rdyg"] as const;
const scale = ["linear", "sqrt", "log"] as const;

const styleFieldsSchema = z
  .object({
    color_property: z.string().trim().min(1).max(200).nullable().optional(),
    color_scheme: z.enum(palette).optional(),
    breaks: z.array(z.number().finite()).max(12).optional(),
    break_mode: z.enum(["auto", "manual"]).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    radius: z.number().finite().min(1).max(12).optional(),
    line_width: z.number().finite().min(1).max(8).optional(),
    radius_property: z.string().trim().min(1).max(200).nullable().optional(),
    line_width_property: z.string().trim().min(1).max(200).nullable().optional(),
    radius_scale: z.enum(scale).optional(),
    line_width_scale: z.enum(scale).optional(),
  })
  .strict();

const catalogLayerInputSchema = z
  .object({
    collection_id: z.number().int().positive(),
    dataset_id: z.number().int().positive(),
    file_id: z.number().int().positive(),
    file_source_id: z.number().int().positive(),
    label: z.string().trim().min(1).max(80).optional(),
    visible: z.boolean().optional(),
  })
  .strict();
const removeLayerSchema = z.object({ map_layer_id: mapLayerIdSchema }).strict();
const visibilitySchema = z.object({ map_layer_id: mapLayerIdSchema, visible: z.boolean() }).strict();
const styleSchema = z
  .object({ style_layer_id: styleLayerIdSchema, ...styleFieldsSchema.shape })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "style_layer_id"), "a style update is required");
const reorderSchema = z.object({ map_layer_ids: z.array(mapLayerIdSchema).min(1).max(50) }).strict();
const mapPositionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const mapBoundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const cameraSchema = z
  .object({
    center: mapPositionSchema.optional(),
    bounds: mapBoundsSchema.optional(),
    map_layer_ids: z.array(mapLayerIdSchema).min(1).max(50).optional(),
    feature_id: z.string().trim().min(1).max(500).optional(),
    zoom: z.number().finite().min(0).max(24).optional(),
    bearing: z.number().finite().min(-360).max(360).optional(),
    pitch: z.number().finite().min(0).max(85).optional(),
    padding: z.number().finite().min(0).max(500).optional(),
  })
  .strict();
const basemapSchema = z.object({ mode: z.enum(["street", "satellite"]) }).strict();
const selectionSchema = z
  .object({
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export interface MapCatalogLayerInput {
  collection_id: number;
  dataset_id: number;
  file_id: number;
  file_source_id: number;
  label?: string | undefined;
  visible?: boolean | undefined;
}

export interface MapToolStyleSummary {
  style_layer_id: string;
  source_layer_id?: string | undefined;
  fields: readonly string[];
  numeric_fields: readonly { name: string; min?: number | undefined; max?: number | undefined }[];
  style?:
    | {
        color_property?: string | null | undefined;
        color_scheme?: string | undefined;
        breaks?: readonly number[] | undefined;
        break_mode?: "auto" | "manual" | undefined;
        opacity?: number | undefined;
        radius?: number | undefined;
        line_width?: number | undefined;
        radius_property?: string | null | undefined;
        line_width_property?: string | null | undefined;
        radius_scale?: "linear" | "sqrt" | "log" | undefined;
        line_width_scale?: "linear" | "sqrt" | "log" | undefined;
      }
    | undefined;
}

export interface MapToolLayer {
  /** Legacy input alias retained for the route adapter; output always uses map_layer_id. */
  id?: string | undefined;
  map_layer_id?: string | undefined;
  label: string;
  kind: "catalog_pmtiles" | "query_mvt";
  visible: boolean;
  status?: "loading" | "ready" | "error" | undefined;
  query_id?: string | undefined;
  style_layers?: readonly MapToolStyleSummary[] | undefined;
}

export interface MapToolSelection {
  id: string;
  loadedLayerId: string;
  sourceLayerId: string;
  featureId: string;
  properties: Readonly<MapToolProperties>;
  sourceKind?: "catalog_pmtiles" | "query_mvt" | undefined;
  queryId?: string | undefined;
}

export interface MapToolProperties {
  [propertyName: string]: string;
}

export interface MapToolCurrentResultSummary {
  query_id: string;
  offset: number;
  limit: number;
  returned_count: number;
  has_more: boolean;
  map_layer_id?: string | null | undefined;
}

export interface MapWebMcpState {
  layers: readonly MapToolLayer[];
  basemap: "street" | "satellite";
  selected_feature_count: number;
  camera?: MapCameraState | null | undefined;
  selected_features?: readonly MapToolSelection[] | undefined;
  current_result?: MapToolCurrentResultSummary | null | undefined;
}

function mapLayerId(layer: MapToolLayer): string {
  return layer.map_layer_id ?? layer.id ?? "";
}

function styleData(style: MapToolStyleSummary["style"]): WebMcpJsonObject | undefined {
  if (!style) return undefined;
  return {
    ...(style.color_property === undefined ? {} : { color_property: style.color_property }),
    ...(style.color_scheme === undefined ? {} : { color_scheme: style.color_scheme }),
    ...(style.breaks === undefined ? {} : { breaks: [...style.breaks] }),
    ...(style.break_mode === undefined ? {} : { break_mode: style.break_mode }),
    ...(style.opacity === undefined ? {} : { opacity: style.opacity }),
    ...(style.radius === undefined ? {} : { radius: style.radius }),
    ...(style.line_width === undefined ? {} : { line_width: style.line_width }),
    ...(style.radius_property === undefined ? {} : { radius_property: style.radius_property }),
    ...(style.line_width_property === undefined ? {} : { line_width_property: style.line_width_property }),
    ...(style.radius_scale === undefined ? {} : { radius_scale: style.radius_scale }),
    ...(style.line_width_scale === undefined ? {} : { line_width_scale: style.line_width_scale }),
  };
}

function styleLayerData(styleLayer: MapToolStyleSummary): WebMcpJsonObject {
  const data: WebMcpJsonObject = {
    style_layer_id: styleLayer.style_layer_id,
    fields: [...styleLayer.fields],
    numeric_fields: styleLayer.numeric_fields.map((field) => ({
      name: field.name,
      ...(field.min === undefined ? {} : { min: field.min }),
      ...(field.max === undefined ? {} : { max: field.max }),
    })),
  };
  if (styleLayer.source_layer_id !== undefined) data["source_layer_id"] = styleLayer.source_layer_id;
  const style = styleData(styleLayer.style);
  if (style !== undefined) data["style"] = style;
  return data;
}

function mapLayerData(layer: MapToolLayer): WebMcpJsonObject {
  const data: WebMcpJsonObject = {
    map_layer_id: mapLayerId(layer),
    label: layer.label,
    kind: layer.kind,
    visible: layer.visible,
  };
  if (layer.status !== undefined) data["status"] = layer.status;
  if (layer.query_id !== undefined) data["query_id"] = layer.query_id;
  if (layer.style_layers !== undefined) data["style_layers"] = layer.style_layers.map(styleLayerData);
  return data;
}

function stateData(state: MapWebMcpState): WebMcpJsonObject {
  const data: WebMcpJsonObject = {
    basemap: state.basemap,
    layers: state.layers.map(mapLayerData),
    selected_feature_count: state.selected_feature_count,
    camera: null,
  };
  if (state.camera !== undefined && state.camera !== null) {
    data["camera"] = {
      center: [state.camera.center[0], state.camera.center[1]],
      zoom: state.camera.zoom,
      bearing: state.camera.bearing,
      pitch: state.camera.pitch,
    };
  }
  if (state.current_result !== undefined) {
    data["current_result"] =
      state.current_result === null
        ? null
        : {
            query_id: state.current_result.query_id,
            offset: state.current_result.offset,
            limit: state.current_result.limit,
            returned_count: state.current_result.returned_count,
            has_more: state.current_result.has_more,
            ...(state.current_result.map_layer_id === undefined
              ? {}
              : { map_layer_id: state.current_result.map_layer_id }),
          };
  }
  return data;
}

function mapFailure(error: Error): WebMcpResult<WebMcpJsonObject> {
  if (error instanceof MapWorkspaceCommandError)
    return failure("invalid_request", "The requested map change is invalid.");
  return failure("internal_error");
}

function styleUpdate(input: z.infer<typeof styleSchema> | z.infer<typeof styleFieldsSchema>): LayerStyleUpdate {
  return {
    ...(input.color_property === undefined ? {} : { colorProperty: input.color_property }),
    ...(input.color_scheme === undefined ? {} : { colorScheme: input.color_scheme }),
    ...(input.breaks === undefined ? {} : { breaks: input.breaks }),
    ...(input.break_mode === undefined ? {} : { breakMode: input.break_mode }),
    ...(input.opacity === undefined ? {} : { opacity: input.opacity }),
    ...(input.radius === undefined ? {} : { radius: input.radius }),
    ...(input.line_width === undefined ? {} : { lineWidth: input.line_width }),
    ...(input.radius_property === undefined ? {} : { radiusProperty: input.radius_property }),
    ...(input.line_width_property === undefined ? {} : { lineWidthProperty: input.line_width_property }),
    ...(input.radius_scale === undefined ? {} : { radiusScale: input.radius_scale }),
    ...(input.line_width_scale === undefined ? {} : { lineWidthScale: input.line_width_scale }),
  };
}

function cameraInput(input: z.infer<typeof cameraSchema>): MapCameraInput {
  const targets = [input.center, input.bounds, input.map_layer_ids, input.feature_id].filter(
    (value) => value !== undefined,
  );
  if (targets.length !== 1) throw new MapWorkspaceCommandError("camera requires exactly one target");
  return {
    ...(input.center === undefined ? {} : { center: input.center }),
    ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
    ...(input.map_layer_ids === undefined ? {} : { layerIds: input.map_layer_ids }),
    ...(input.feature_id === undefined ? {} : { featureId: input.feature_id }),
    ...(input.zoom === undefined ? {} : { zoom: input.zoom }),
    ...(input.bearing === undefined ? {} : { bearing: input.bearing }),
    ...(input.pitch === undefined ? {} : { pitch: input.pitch }),
    ...(input.padding === undefined ? {} : { padding: input.padding }),
  };
}

type CatalogLayerResolver = (input: MapCatalogLayerInput) => Promise<DatasetLayerInput>;

async function addCatalogLayer(
  input: z.infer<typeof catalogLayerInputSchema>,
  commands: MapWorkspaceCommands,
  resolveCatalogLayer: CatalogLayerResolver,
): Promise<WebMcpResult<WebMcpJsonObject>> {
  const layer = await commands.addDatasetLayer(await resolveCatalogLayer(input));
  if (input.visible !== undefined && input.visible !== layer.visible) {
    commands.setLayerVisibility(layer.id, input.visible);
  }
  return success("Dataset layer added.", {
    layer: {
      map_layer_id: layer.id,
      label: layer.label,
      kind: layer.kind,
      visible: input.visible ?? layer.visible,
    },
  });
}

function selectionData(state: MapWebMcpState, offset: number, limit: number): WebMcpJsonObject {
  const features = state.selected_features ?? [];
  const page = features.slice(offset, offset + limit).map((feature) => ({
    feature_id: feature.featureId,
    map_layer_id: feature.loadedLayerId,
    source_layer_id: feature.sourceLayerId,
    properties: { ...feature.properties },
    ...(feature.sourceKind === undefined ? {} : { source_kind: feature.sourceKind }),
    ...(feature.queryId === undefined ? {} : { query_id: feature.queryId }),
  }));
  return {
    offset,
    limit,
    returned_count: page.length,
    total_count: state.selected_feature_count,
    has_more: offset + page.length < state.selected_feature_count,
    features: page,
  };
}

export function useMapWebMcpTools({
  enabled,
  commands,
  getState,
  resolveCatalogLayer,
}: {
  enabled: boolean;
  commands: MapWorkspaceCommands;
  getState: () => MapWebMcpState;
  resolveCatalogLayer?: CatalogLayerResolver | undefined;
}): void {
  const state = getState();
  const layerCount = state.layers.length;
  const hasStyleLayer = state.layers.some((layer) => (layer.style_layers?.length ?? 0) > 0);
  const hasSelection = state.selected_feature_count > 0;
  const getMapState = useCallback(() => success("Map state loaded.", stateData(getState())), [getState]);
  const addLayer = useCallback(
    async (input: z.infer<typeof catalogLayerInputSchema>) => {
      try {
        if (!resolveCatalogLayer) return failure("unsupported_state", "Catalog layer resolution is unavailable.");
        return await addCatalogLayer(input, commands, resolveCatalogLayer);
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands, resolveCatalogLayer],
  );
  const removeLayer = useCallback(
    (input: z.infer<typeof removeLayerSchema>) => {
      try {
        commands.removeLayer(input.map_layer_id);
        return success("Map layer removed.", { map_layer_id: input.map_layer_id });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const setVisibility = useCallback(
    (input: z.infer<typeof visibilitySchema>) => {
      try {
        commands.setLayerVisibility(input.map_layer_id, input.visible);
        return success("Map layer visibility updated.", { map_layer_id: input.map_layer_id, visible: input.visible });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const setStyle = useCallback(
    (input: z.infer<typeof styleSchema>) => {
      try {
        commands.setLayerStyle(input.style_layer_id, styleUpdate(input));
        return success("Map layer style updated.", { style_layer_id: input.style_layer_id });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const reorderLayers = useCallback(
    (input: z.infer<typeof reorderSchema>) => {
      try {
        commands.reorderLayers(input.map_layer_ids);
        return success("Map layer order updated.", { map_layer_ids: input.map_layer_ids });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const setCamera = useCallback(
    async (input: z.infer<typeof cameraSchema>) => {
      try {
        const camera = await commands.setCamera(cameraInput(input));
        return success("Map camera updated.", {
          center: [camera.center[0], camera.center[1]],
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const setBasemap = useCallback(
    (input: z.infer<typeof basemapSchema>) => {
      try {
        commands.setBasemap(input.mode);
        return success("Basemap updated.", { mode: input.mode });
      } catch (error) {
        return error instanceof Error ? mapFailure(error) : failure("internal_error");
      }
    },
    [commands],
  );
  const getSelection = useCallback(
    (input: z.infer<typeof selectionSchema>) =>
      success("Map selection loaded.", selectionData(getState(), input.offset, input.limit)),
    [getState],
  );
  const clearSelection = useCallback(() => {
    commands.clearSelection();
    return success("Map selection cleared.", { selected_feature_count: 0 });
  }, [commands]);

  const annotations: WebMCP.ToolAnnotations = { untrustedContentHint: true };
  const common = { routeKind: "map" as const, annotations };
  useWebMcpTool({
    name: "get_map_state",
    title: "Get map state",
    description: "Get loaded map layers and map state.",
    schema: emptyInputSchema,
    execute: getMapState,
    enabled,
    ...common,
    annotations: { ...annotations, readOnlyHint: true },
  });
  useWebMcpTool({
    name: "add_dataset_layer",
    title: "Add dataset layer",
    description: "Add a catalog dataset layer to the map.",
    schema: catalogLayerInputSchema,
    execute: addLayer,
    enabled,
    ...common,
  });
  useWebMcpTool({
    name: "remove_map_layer",
    title: "Remove map layer",
    description: "Remove a loaded map layer.",
    schema: removeLayerSchema,
    execute: removeLayer,
    enabled: enabled && layerCount > 0,
    ...common,
  });
  useWebMcpTool({
    name: "set_layer_visibility",
    title: "Set layer visibility",
    description: "Show or hide a map layer.",
    schema: visibilitySchema,
    execute: setVisibility,
    enabled: enabled && layerCount > 0,
    ...common,
  });
  useWebMcpTool({
    name: "set_layer_style",
    title: "Set layer style",
    description: "Update approved map layer styling properties.",
    schema: styleSchema,
    execute: setStyle,
    enabled: enabled && hasStyleLayer,
    ...common,
  });
  useWebMcpTool({
    name: "reorder_map_layers",
    title: "Reorder map layers",
    description: "Set the complete loaded map layer order.",
    schema: reorderSchema,
    execute: reorderLayers,
    enabled: enabled && layerCount >= 2,
    ...common,
  });
  useWebMcpTool({
    name: "set_map_camera",
    title: "Set map camera",
    description: "Move the map camera to one target.",
    schema: cameraSchema,
    execute: setCamera,
    enabled,
    ...common,
  });
  useWebMcpTool({
    name: "set_basemap",
    title: "Set basemap",
    description: "Switch between street and satellite basemaps.",
    schema: basemapSchema,
    execute: setBasemap,
    enabled,
    ...common,
  });
  useWebMcpTool({
    name: "get_map_selection",
    title: "Get map selection",
    description: "Get a bounded page of selected map feature properties.",
    schema: selectionSchema,
    execute: getSelection,
    enabled: enabled && hasSelection,
    ...common,
    annotations: { ...annotations, readOnlyHint: true },
  });
  useWebMcpTool({
    name: "clear_map_selection",
    title: "Clear map selection",
    description: "Clear the current map selection.",
    schema: emptyInputSchema,
    execute: clearSelection,
    enabled: enabled && hasSelection,
    ...common,
  });
}
