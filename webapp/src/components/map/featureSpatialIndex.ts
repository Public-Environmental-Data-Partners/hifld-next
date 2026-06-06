import { S2CellId, S2LatLng } from "nodes2ts";

export interface FeaturePoint {
  lng: number;
  lat: number;
}

export interface FeatureS2Cell {
  token: string;
  level: number;
  neighbors: string[];
}

function validLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > S2CellId.MAX_LEVEL) {
    return 16;
  }
  return level;
}

export function s2CellForPoint(point: FeaturePoint, level: number): FeatureS2Cell {
  const resolvedLevel = validLevel(level);
  const leafCell = S2CellId.fromPoint(S2LatLng.fromDegrees(point.lat, point.lng).toPoint());
  const cell = leafCell.parentL(resolvedLevel);
  const tokens = new Set<string>([cell.toToken()]);
  for (const neighbor of cell.getAllNeighbors(resolvedLevel)) {
    tokens.add(neighbor.toToken());
  }

  return {
    token: cell.toToken(),
    level: resolvedLevel,
    neighbors: [...tokens],
  };
}
