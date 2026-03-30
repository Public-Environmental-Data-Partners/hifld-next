import type { HoverInfo } from '../types'
import type maplibregl from 'maplibre-gl'

export const createMockFeature = (
  overrides?: Partial<maplibregl.MapGeoJSONFeature>
): maplibregl.MapGeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { name: 'Test Feature', id: 1 },
  layer: { id: 'test-layer' },
  ...overrides,
} as any)

export const createMockHoverInfo = (
  overrides?: Partial<HoverInfo>
): HoverInfo => ({
  x: 100,
  y: 200,
  features: [createMockFeature()],
  selectedIndex: 0,
  isPinned: false,
  ...overrides,
})

export const createMockMapEvent = (overrides?: any) => ({
  point: { x: 100, y: 200 },
  lngLat: { lng: 0, lat: 0 },
  originalEvent: new MouseEvent('click'),
  ...overrides,
})

