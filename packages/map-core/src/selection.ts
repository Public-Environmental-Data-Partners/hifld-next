export interface ScreenPoint {
  x: number;
  y: number;
}

export interface LngLatPoint {
  lng: number;
  lat: number;
}

export type ScreenBounds = [[number, number], [number, number]];
export type PolygonPosition = [number, number];

export interface SelectionBoxFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: {
    type: "Polygon";
    coordinates: [[PolygonPosition, PolygonPosition, PolygonPosition, PolygonPosition, PolygonPosition]];
  };
}

export const MAX_SELECTED_FEATURES = 100;
const MIN_SELECTION_DRAG_DISTANCE = 4;

export function isSelectionDrag(start: ScreenPoint, end: ScreenPoint): boolean {
  return (
    Math.abs(end.x - start.x) >= MIN_SELECTION_DRAG_DISTANCE ||
    Math.abs(end.y - start.y) >= MIN_SELECTION_DRAG_DISTANCE
  );
}

export function selectionBoxFeature(start: LngLatPoint, end: LngLatPoint): SelectionBoxFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [start.lng, start.lat],
          [end.lng, start.lat],
          [end.lng, end.lat],
          [start.lng, end.lat],
          [start.lng, start.lat],
        ],
      ],
    },
  };
}

export function selectionScreenBounds(start: ScreenPoint, end: ScreenPoint): ScreenBounds {
  return [
    [Math.min(start.x, end.x), Math.min(start.y, end.y)],
    [Math.max(start.x, end.x), Math.max(start.y, end.y)],
  ];
}
