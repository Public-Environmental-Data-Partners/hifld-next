import type { LayerStyleUpdate, NumericFieldSummary, VectorLayerInfo } from "@/components/viewer/types";
import type { LoadedMapLayer, MapBounds } from "./multiLayerSources";

export type BasemapMode = "street" | "satellite";

export interface MapLayerSummary {
  id: string;
  label: string;
  kind: LoadedMapLayer["kind"];
  visible: boolean;
}

export interface DatasetLayerInput {
  layerId: string;
  label: string;
  kind?: LoadedMapLayer["kind"] | undefined;
}

export type { LayerStyleUpdate } from "@/components/viewer/types";

export type StyleLayerTarget = Pick<VectorLayerInfo, "id" | "fields" | "numericFields" | "geometryType">;

export interface MapCameraTarget {
  bounds?: MapBounds | undefined;
  center?: [number, number] | undefined;
  layerIds?: readonly string[] | undefined;
  featureId?: string | undefined;
  zoom?: number | undefined;
}

export interface MapCameraInput {
  target?: MapCameraTarget | undefined;
  bounds?: MapBounds | undefined;
  center?: [number, number] | undefined;
  layerIds?: readonly string[] | undefined;
  featureId?: string | undefined;
  zoom?: number | undefined;
  bearing?: number | undefined;
  pitch?: number | undefined;
  padding?: number | undefined;
}

export interface MapCameraState {
  center: readonly [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapWorkspaceCommands {
  addDatasetLayer(input: DatasetLayerInput): Promise<MapLayerSummary>;
  removeLayer(layerId: string): void;
  setLayerVisibility(layerId: string, visible: boolean): void;
  setLayerStyle(styleLayerId: string, update: LayerStyleUpdate): void;
  reorderLayers(layerIds: string[]): void;
  setCamera(camera: MapCameraInput): Promise<MapCameraState>;
  setBasemap(mode: BasemapMode): void;
  clearSelection(): void;
}

export class MapWorkspaceCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapWorkspaceCommandError";
  }
}

function fail(message: string): never {
  throw new MapWorkspaceCommandError(message);
}

function layerById(layerId: string, layers: readonly MapLayerSummary[]): MapLayerSummary {
  if (!layerId.trim()) {
    return fail("layer ID must not be empty");
  }
  const layer = layers.find((entry) => entry.id === layerId);
  return layer ?? fail(`layer ${layerId} does not exist`);
}

export function assertValidAddDatasetLayer(input: DatasetLayerInput, layers: readonly MapLayerSummary[]): void {
  if (!input.layerId.trim()) {
    fail("layer ID must not be empty");
  }
  if (!input.label.trim()) {
    fail("layer label must not be empty");
  }
  if (layers.some((layer) => layer.id === input.layerId)) {
    fail(`layer ${input.layerId} is already loaded`);
  }
}

export function assertValidLayerRemoval(layerId: string, layers: readonly MapLayerSummary[]): void {
  layerById(layerId, layers);
}

export function assertValidLayerVisibility(
  layerId: string,
  visible: boolean,
  layers: readonly MapLayerSummary[],
): void {
  layerById(layerId, layers);
  if (typeof visible !== "boolean") {
    fail("layer visibility must be boolean");
  }
}

export function assertValidLayerOrder(layerIds: readonly string[], layers: readonly MapLayerSummary[]): void {
  if (layerIds.length !== layers.length) {
    fail("layer order must contain every loaded layer exactly once");
  }
  const expected = new Set(layers.map((layer) => layer.id));
  const actual = new Set(layerIds);
  if (actual.size !== layerIds.length || actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) {
    fail("layer order must contain every loaded layer exactly once");
  }
}

function numericField(target: StyleLayerTarget, property: string | null | undefined): NumericFieldSummary | undefined {
  if (property === null || property === undefined) {
    return undefined;
  }
  if (!target.fields.includes(property)) {
    fail(`unknown field ${property}`);
  }
  return target.numericFields.find((field) => field.name === property);
}

function validateBreaks(breaks: readonly number[], field: NumericFieldSummary | undefined): void {
  if (breaks.some((value) => !Number.isFinite(value))) {
    fail("breaks must contain finite numbers");
  }
  for (let index = 1; index < breaks.length; index += 1) {
    if ((breaks[index] ?? 0) <= (breaks[index - 1] ?? 0)) {
      fail("breaks must be strictly increasing");
    }
  }
  const minimum = field?.min;
  const maximum = field?.max;
  if (minimum !== undefined && breaks.some((value) => value < minimum)) {
    fail("breaks must be within the field range");
  }
  if (maximum !== undefined && breaks.some((value) => value > maximum)) {
    fail("breaks must be within the field range");
  }
}

function validateScale(scale: string | undefined, name: string): void {
  if (scale !== undefined && scale !== "linear" && scale !== "sqrt" && scale !== "log") {
    fail(`${name} scale is invalid`);
  }
}

function validateStyleKeys(update: LayerStyleUpdate): void {
  const knownKeys = new Set([
    "colorProperty",
    "colorScheme",
    "breaks",
    "breakMode",
    "opacity",
    "radius",
    "lineWidth",
    "radiusProperty",
    "lineWidthProperty",
    "radiusScale",
    "lineWidthScale",
  ]);
  for (const key of Object.keys(update)) {
    if (!knownKeys.has(key)) {
      fail(`unsupported style field ${key}`);
    }
  }
}

function validateStyleFields(target: StyleLayerTarget, update: LayerStyleUpdate): NumericFieldSummary | undefined {
  const colorField = numericField(target, update.colorProperty);
  const radiusField = numericField(target, update.radiusProperty);
  const lineWidthField = numericField(target, update.lineWidthProperty);
  if (update.colorProperty !== null && update.colorProperty !== undefined && !colorField) {
    fail(`field ${update.colorProperty} is not numeric`);
  }
  if (update.radiusProperty !== null && update.radiusProperty !== undefined && !radiusField) {
    fail(`field ${update.radiusProperty} is not numeric`);
  }
  if (update.lineWidthProperty !== null && update.lineWidthProperty !== undefined && !lineWidthField) {
    fail(`field ${update.lineWidthProperty} is not numeric`);
  }
  return colorField;
}

function validateStyleBreaksAndPalette(update: LayerStyleUpdate, colorField: NumericFieldSummary | undefined): void {
  if (
    update.colorScheme !== undefined &&
    !["blues", "greens", "oranges", "purples", "viridis", "plasma", "rdyblu", "rdyg"].includes(update.colorScheme)
  ) {
    fail(`palette ${update.colorScheme} is invalid`);
  }
  if (update.breakMode !== undefined && update.breakMode !== "auto" && update.breakMode !== "manual") {
    fail("break mode is invalid");
  }
  if (update.breaks !== undefined) {
    validateBreaks(update.breaks, colorField);
  }
}

function validateStyleRanges(update: LayerStyleUpdate): void {
  for (const [name, value, minimum, maximum] of [
    ["opacity", update.opacity, 0, 1],
    ["radius", update.radius, 1, 12],
    ["line width", update.lineWidth, 1, 8],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
      fail(`${name} must be within its valid range`);
    }
  }
  validateScale(update.radiusScale, "radius");
  validateScale(update.lineWidthScale, "line width");
}

function validateStyleGeometry(target: StyleLayerTarget, update: LayerStyleUpdate): void {
  const geometryType = target.geometryType?.toLowerCase();
  const supportsPoint =
    !geometryType || geometryType === "mixed" || geometryType === "geometry" || geometryType.includes("point");
  const supportsLine =
    !geometryType || geometryType === "mixed" || geometryType === "geometry" || geometryType.includes("line");
  if (update.radiusScale !== undefined && !supportsPoint) {
    fail("radius scale is only valid for point geometry");
  }
  if (update.lineWidthScale !== undefined && !supportsLine) {
    fail("line width scale is only valid for line geometry");
  }
}

export function assertValidLayerStyleUpdate(target: StyleLayerTarget, update: LayerStyleUpdate): void {
  validateStyleKeys(update);
  const colorField = validateStyleFields(target, update);
  validateStyleBreaksAndPalette(update, colorField);
  validateStyleRanges(update);
  validateStyleGeometry(target, update);
}

function cameraTarget(input: MapCameraInput): MapCameraTarget {
  const directTargetKeys = [input.bounds, input.center, input.layerIds, input.featureId].filter(
    (value) => value !== undefined,
  ).length;
  if (input.target && directTargetKeys > 0) {
    fail("camera must use exactly one target form");
  }
  return (
    input.target ?? {
      ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
      ...(input.center === undefined ? {} : { center: input.center }),
      ...(input.layerIds === undefined ? {} : { layerIds: input.layerIds }),
      ...(input.featureId === undefined ? {} : { featureId: input.featureId }),
    }
  );
}

export function assertValidCameraInput(input: MapCameraInput): void {
  const target = cameraTarget(input);
  const targetCount = [target.bounds, target.center, target.layerIds, target.featureId].filter(
    (value) => value !== undefined,
  ).length;
  if (targetCount !== 1) {
    fail("camera must contain exactly one target form");
  }
  validateCameraTarget(target);
  validateCameraOptions(input);
}

function validateCameraTarget(target: MapCameraTarget): void {
  if (target.bounds) {
    if (
      target.bounds.some((value) => !Number.isFinite(value)) ||
      target.bounds[0] > target.bounds[2] ||
      target.bounds[1] > target.bounds[3]
    ) {
      fail("camera bounds are invalid");
    }
  }
  if (
    target.center &&
    (target.center.some((value) => !Number.isFinite(value)) ||
      target.center[0] < -180 ||
      target.center[0] > 180 ||
      target.center[1] < -90 ||
      target.center[1] > 90)
  ) {
    fail("camera center is invalid");
  }
  if (target.layerIds && (target.layerIds.length === 0 || target.layerIds.some((id) => !id.trim()))) {
    fail("camera layer IDs are invalid");
  }
  if (target.featureId !== undefined && !target.featureId.trim()) {
    fail("camera feature ID must not be empty");
  }
  if (target.zoom !== undefined && (!Number.isFinite(target.zoom) || target.zoom < 0 || target.zoom > 24)) {
    fail("camera zoom is invalid");
  }
}

function validateCameraOptions(input: MapCameraInput): void {
  for (const [name, value] of [
    ["zoom", input.zoom],
    ["bearing", input.bearing],
    ["pitch", input.pitch],
    ["padding", input.padding],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      fail(`camera ${name} is invalid`);
    }
  }
  if (input.pitch !== undefined && (input.pitch < 0 || input.pitch > 85)) {
    fail("camera pitch is invalid");
  }
  if (input.padding !== undefined && input.padding < 0) {
    fail("camera padding is invalid");
  }
}

export function assertValidBasemap(mode: BasemapMode): void {
  if (mode !== "street" && mode !== "satellite") {
    fail("basemap mode is invalid");
  }
}

export function assertValidSelectionClear(): void {
  // Kept as a pure validation boundary so selection commands remain atomic.
}

// Named aliases keep the validation surface discoverable to command adapters.
export const validateAddDatasetLayer = assertValidAddDatasetLayer;
export const validateLayerRemoval = assertValidLayerRemoval;
export const validateLayerVisibility = assertValidLayerVisibility;
export const validateLayerOrder = assertValidLayerOrder;
export const validateLayerStyleUpdate = assertValidLayerStyleUpdate;
export const validateCameraInput = assertValidCameraInput;
export const validateBasemap = assertValidBasemap;
