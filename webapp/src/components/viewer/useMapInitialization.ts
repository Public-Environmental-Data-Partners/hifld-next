import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
import type { VectorLayerInfo, HoverInfo } from "./types";
import { DEFAULT_STYLE } from "./utils";

export function useMapInitialization(
  mapContainerRef: React.RefObject<HTMLDivElement | null>,
  pmtilesUrl: string | null,
  onLayersLoaded: (layers: VectorLayerInfo[]) => void,
  onHover: (info: HoverInfo | null) => void,
  onPinnedPopup?: (info: HoverInfo | null) => void
) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const protocolRef = useRef<Protocol | null>(null);
  const pmtilesUrlRef = useRef<string | null>(null);
  const interactiveLayerIds = useRef<string[]>([]);
  const hoveredFeatureRef = useRef<{
    sourceLayer: string;
    id: number | string;
  } | null>(null);

  const clearHoverFeature = () => {
    if (!mapRef.current || !hoveredFeatureRef.current) return;
    mapRef.current.setFeatureState(
      {
        source: "pmtiles",
        sourceLayer: hoveredFeatureRef.current.sourceLayer,
        id: hoveredFeatureRef.current.id,
      },
      { hover: false }
    );
    hoveredFeatureRef.current = null;
  };

  const setHoverFeature = (feature: maplibregl.MapGeoJSONFeature | null) => {
    if (!mapRef.current || !feature) return;
    const styleLayerId = feature.layer?.id;
    const styleLayer = styleLayerId
      ? (mapRef.current.getLayer(styleLayerId) as any)
      : null;
    const sourceLayer =
      (feature as any).sourceLayer || styleLayer?.["source-layer"];
    const featureId = feature.id;
    if (!sourceLayer || featureId === undefined || featureId === null) return;

    if (
      hoveredFeatureRef.current &&
      hoveredFeatureRef.current.sourceLayer === sourceLayer &&
      hoveredFeatureRef.current.id === featureId
    ) {
      return;
    }

    clearHoverFeature();
    mapRef.current.setFeatureState(
      {
        source: "pmtiles",
        sourceLayer,
        id: featureId,
      },
      { hover: true }
    );
    hoveredFeatureRef.current = { sourceLayer, id: featureId };
  };

  useEffect(() => {
    if (!mapContainerRef.current || !pmtilesUrl) return;

    if (pmtilesUrlRef.current && pmtilesUrlRef.current !== pmtilesUrl) {
      mapRef.current?.remove();
      mapRef.current = null;
      interactiveLayerIds.current = [];
      onLayersLoaded([]);
    }

    if (mapRef.current) return;
    pmtilesUrlRef.current = pmtilesUrl;

    protocolRef.current = new Protocol();
    maplibregl.addProtocol("pmtiles", protocolRef.current.tile);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-base",
            type: "raster",
            source: "osm-tiles",
          },
        ],
      },
      center: [-98.5795, 39.8283],
      zoom: 4,
    });

    mapRef.current = map;

    map.on("load", async () => {
      const pmtiles = new PMTiles(pmtilesUrl);
      protocolRef.current?.add(pmtiles);
      const metadata = await pmtiles.getMetadata();
      const vectorLayersMeta = Array.isArray(metadata?.vector_layers)
        ? metadata.vector_layers
        : [];

      const layers: VectorLayerInfo[] = vectorLayersMeta.map((layer: any) => ({
        id: layer.id,
        fields: Object.keys(layer.fields || {}),
      }));

      onLayersLoaded(layers);

      map.addSource("pmtiles", {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
      });

      const interactiveIds: string[] = [];

      layers.forEach((layer) => {
        const baseId = `pmtiles-${layer.id}`;
        const fillId = `${baseId}-fill`;
        const lineId = `${baseId}-line`;
        const circleId = `${baseId}-circle`;

        map.addLayer({
          id: fillId,
          type: "fill",
          source: "pmtiles",
          "source-layer": layer.id,
          filter: ["==", "$type", "Polygon"],
          paint: {
            "fill-color": "#3b82f6",
            "fill-opacity": DEFAULT_STYLE.opacity,
          },
        });

        map.addLayer({
          id: lineId,
          type: "line",
          source: "pmtiles",
          "source-layer": layer.id,
          filter: ["==", "$type", "LineString"],
          paint: {
            "line-color": "#2563eb",
            "line-opacity": DEFAULT_STYLE.opacity,
            "line-width": DEFAULT_STYLE.lineWidth,
          },
        });

        map.addLayer({
          id: circleId,
          type: "circle",
          source: "pmtiles",
          "source-layer": layer.id,
          filter: ["==", "$type", "Point"],
          paint: {
            "circle-color": "#1d4ed8",
            "circle-opacity": DEFAULT_STYLE.opacity,
            "circle-radius": DEFAULT_STYLE.radius,
          },
        });

        interactiveIds.push(fillId, lineId, circleId);
      });

      interactiveLayerIds.current = interactiveIds;
      map.resize();
    });

    map.on("mousemove", (event) => {
      if (!mapRef.current || interactiveLayerIds.current.length === 0) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: interactiveLayerIds.current,
      });

      if (!features || features.length === 0) {
        onHover(null);
        return;
      }

      onHover({
        x: event.point.x,
        y: event.point.y,
        features,
        selectedIndex: 0,
        isPinned: false,
      });
    });

    map.on("click", (event) => {
      if (!mapRef.current || interactiveLayerIds.current.length === 0) return;
      
      const features = map.queryRenderedFeatures(event.point, {
        layers: interactiveLayerIds.current,
      });

      if (features && features.length > 0) {
        // Pin the popup on click - store both screen and geographic coordinates
        if (onPinnedPopup) {
          onPinnedPopup({
            x: event.point.x,
            y: event.point.y,
            features,
            selectedIndex: 0,
            isPinned: true,
            lngLat: event.lngLat,
          });
        }
      } else {
        // Click on empty map - clear pinned popup
        if (onPinnedPopup) {
          onPinnedPopup(null);
        }
      }
    });

    map.on("mouseleave", () => {
      clearHoverFeature();
      // Only clear hover, not pinned popup
      onHover(null);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pmtilesUrl, mapContainerRef, onLayersLoaded, onHover, onPinnedPopup]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.resize();
  }, [pmtilesUrl]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return {
    mapRef,
    interactiveLayerIds,
    hoveredFeatureRef,
    setHoverFeature,
    clearHoverFeature,
  };
}

