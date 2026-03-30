import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMapInitialization } from '../useMapInitialization'
import maplibregl from 'maplibre-gl'

// Mock maplibre-gl
vi.mock('maplibre-gl', () => {
  const mockMap = {
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    queryRenderedFeatures: vi.fn(),
    setFeatureState: vi.fn(),
    resize: vi.fn(),
    getLayer: vi.fn(),
  }

  return {
    default: {
      Map: vi.fn(() => mockMap),
      addProtocol: vi.fn(),
    },
  }
})

// Mock pmtiles
vi.mock('pmtiles', () => ({
  PMTiles: vi.fn(() => ({
    getMetadata: vi.fn().mockResolvedValue({
      vector_layers: [{ id: 'test-layer', fields: { name: 'String' } }],
    }),
  })),
  Protocol: vi.fn(() => ({
    add: vi.fn(),
    tile: vi.fn(),
  })),
}))

describe('useMapInitialization', () => {
  let mapContainer: HTMLDivElement
  let mockMap: any

  beforeEach(() => {
    mapContainer = document.createElement('div')
    document.body.appendChild(mapContainer)
    
    mockMap = {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      queryRenderedFeatures: vi.fn(),
      setFeatureState: vi.fn(),
      resize: vi.fn(),
      getLayer: vi.fn(),
    }

    vi.mocked(maplibregl.Map).mockImplementation(() => mockMap)
  })

  afterEach(() => {
    if (mapContainer.parentNode) {
      document.body.removeChild(mapContainer)
    }
    vi.clearAllMocks()
  })

  it('initializes map with container ref', async () => {
    const onLayersLoaded = vi.fn()
    const onHover = vi.fn()
    const onPinnedPopup = vi.fn()

    const containerRef = { current: mapContainer }

    renderHook(() =>
      useMapInitialization(
        containerRef,
        'http://example.com/tiles.pmtiles',
        onLayersLoaded,
        onHover,
        onPinnedPopup
      )
    )

    await waitFor(() => {
      expect(maplibregl.Map).toHaveBeenCalled()
    })
  })

  it('sets up click event handler for pinned popup', async () => {
    const onPinnedPopup = vi.fn()
    const containerRef = { current: mapContainer }

    renderHook(() =>
      useMapInitialization(
        containerRef,
        'http://example.com/tiles.pmtiles',
        vi.fn(),
        vi.fn(),
        onPinnedPopup
      )
    )

    await waitFor(() => {
      expect(mockMap.on).toHaveBeenCalledWith('click', expect.any(Function))
    })

    // Simulate click event
    const clickHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'click'
    )?.[1]

    const mockFeatures = [
      {
        type: 'Feature',
        properties: { name: 'Test' },
        layer: { id: 'test-layer' },
      },
    ]

    mockMap.queryRenderedFeatures.mockReturnValue(mockFeatures)

    if (clickHandler) {
      clickHandler({
        point: { x: 100, y: 200 },
        lngLat: { lng: 0, lat: 0 },
      })

      expect(onPinnedPopup).toHaveBeenCalledWith({
        x: 100,
        y: 200,
        features: mockFeatures,
        selectedIndex: 0,
        isPinned: true,
      })
    }
  })

  it('clears pinned popup when clicking empty map', async () => {
    const onPinnedPopup = vi.fn()
    const containerRef = { current: mapContainer }

    renderHook(() =>
      useMapInitialization(
        containerRef,
        'http://example.com/tiles.pmtiles',
        vi.fn(),
        vi.fn(),
        onPinnedPopup
      )
    )

    await waitFor(() => {
      expect(mockMap.on).toHaveBeenCalledWith('click', expect.any(Function))
    })

    const clickHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'click'
    )?.[1]

    mockMap.queryRenderedFeatures.mockReturnValue([])

    if (clickHandler) {
      clickHandler({
        point: { x: 100, y: 200 },
        lngLat: { lng: 0, lat: 0 },
      })

      expect(onPinnedPopup).toHaveBeenCalledWith(null)
    }
  })

  it('maintains hover behavior when pinned popup exists', async () => {
    const onHover = vi.fn()
    const containerRef = { current: mapContainer }

    renderHook(() =>
      useMapInitialization(
        containerRef,
        'http://example.com/tiles.pmtiles',
        vi.fn(),
        onHover,
        vi.fn()
      )
    )

    await waitFor(() => {
      expect(mockMap.on).toHaveBeenCalledWith('mousemove', expect.any(Function))
    })

    const mousemoveHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'mousemove'
    )?.[1]

    const mockFeatures = [
      {
        type: 'Feature',
        properties: { name: 'Hover Feature' },
        layer: { id: 'test-layer' },
      },
    ]

    mockMap.queryRenderedFeatures.mockReturnValue(mockFeatures)

    if (mousemoveHandler) {
      mousemoveHandler({
        point: { x: 150, y: 250 },
      })

      expect(onHover).toHaveBeenCalledWith({
        x: 150,
        y: 250,
        features: mockFeatures,
        selectedIndex: 0,
        isPinned: false,
      })
    }
  })

  it('does not require onPinnedPopup callback', async () => {
    const containerRef = { current: mapContainer }

    renderHook(() =>
      useMapInitialization(
        containerRef,
        'http://example.com/tiles.pmtiles',
        vi.fn(),
        vi.fn()
        // onPinnedPopup not provided
      )
    )

    await waitFor(() => {
      expect(maplibregl.Map).toHaveBeenCalled()
    })

    // Should still set up click handler even without callback
    await waitFor(() => {
      expect(mockMap.on).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })
})

