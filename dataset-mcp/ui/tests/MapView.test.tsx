import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type {
  AddLayerObject,
  MapLayerMouseEvent,
  MapOptions,
  SourceSpecification,
} from "maplibre-gl";
import { AJAXError } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialMapView,
  type MapConfiguration,
  MapView,
  type MapViewProps,
  mapErrorMessage,
  mapTileRequest,
  normalizeMapConfiguration,
} from "../src/components/MapView";

interface MockRenderedFeature {
  id?: number | string;
  source?: string;
  sourceLayer?: string;
  geometry?: { type: "Point"; coordinates: [number, number] };
  layer: { id: string };
  properties: Record<string, string>;
}

interface MockMapEvent {
  point: { x: number; y: number };
  lngLat?: { lng: number; lat: number };
  originalEvent?: { shiftKey?: boolean };
  preventDefault?: () => void;
}

type ModelContextUpdateResult = Awaited<
  ReturnType<NonNullable<MapViewProps["app"]>["updateModelContext"]>
>;

const mapConstructor = vi.hoisted(() => vi.fn());
const mapStop = vi.hoisted(() => vi.fn());
const mapAddSource = vi.hoisted(() => vi.fn());
const mapAddLayer = vi.hoisted(() => vi.fn());
const mapSetLayoutProperty = vi.hoisted(() => vi.fn());
const mapSetPaintProperty = vi.hoisted(() => vi.fn());
const mapZoomIn = vi.hoisted(() => vi.fn());
const mapZoomOut = vi.hoisted(() => vi.fn());
const mapEaseTo = vi.hoisted(() => vi.fn());
const mapGetZoom = vi.hoisted(() => vi.fn(() => 6));
const mapQuerySourceFeatures = vi.hoisted(() =>
  vi.fn(
    (
      _sourceId: string,
      _options?: { sourceLayer?: string },
    ): Array<{ properties: Record<string, string | number> }> => [],
  ),
);
const mapQueryRenderedFeatures = vi.hoisted(() =>
  vi.fn(
    (
      _geometry?:
        | { x: number; y: number }
        | [[number, number], [number, number]],
      _options?: { layers?: string[] },
    ): MockRenderedFeature[] => [],
  ),
);
const mapSetData = vi.hoisted(() => vi.fn());
const mapIsStyleLoaded = vi.hoisted(() => vi.fn(() => true));
const mapAutoEvents = vi.hoisted(() => new Set(["load", "idle"]));
const mapDragPanDisable = vi.hoisted(() => vi.fn());
const mapDragPanEnable = vi.hoisted(() => vi.fn());
const mapCanvas = vi.hoisted(() => ({ style: { cursor: "" } }));
const mapEvents = vi.hoisted(
  () =>
    ({ click: null, mousedown: null, mousemove: null, mouseup: null }) as {
      click: ((event: MockMapEvent) => void) | null;
      mousedown: ((event: MockMapEvent) => void) | null;
      mousemove: ((event: MockMapEvent) => void) | null;
      mouseup: ((event: MockMapEvent) => void) | null;
    },
);

vi.mock("maplibre-gl", () => ({
  AJAXError: class AJAXError extends Error {
    status: number;
    statusText: string;
    url: string;
    body: Blob;

    constructor(status: number, statusText: string, url: string, body: Blob) {
      super(`AJAXError: ${statusText} (${status}): ${url}`);
      this.status = status;
      this.statusText = statusText;
      this.url = url;
      this.body = body;
    }
  },
  Map: class MapMock {
    constructor(options: MapOptions) {
      mapConstructor(options);
    }
    once(event: string, listener: () => void) {
      if (mapAutoEvents.has(event)) listener();
      return this;
    }
    isStyleLoaded() {
      return mapIsStyleLoaded();
    }
    on(event: string, listener: (event: MockMapEvent) => void) {
      if (event === "click") mapEvents.click = listener;
      if (event === "mousedown") mapEvents.mousedown = listener;
      if (event === "mousemove") mapEvents.mousemove = listener;
      if (event === "mouseup") mapEvents.mouseup = listener;
      return this;
    }
    addSource(id: string, source: SourceSpecification) {
      mapAddSource(id, source);
      return this;
    }
    addLayer(layer: AddLayerObject, before?: string) {
      mapAddLayer(layer, before);
      return this;
    }
    getSource(id: string) {
      if (id === "selection-box-source") return { setData: mapSetData };
      return mapAddSource.mock.calls.some(([sourceId]) => sourceId === id)
        ? {}
        : undefined;
    }
    getLayer(id: string) {
      return mapAddLayer.mock.calls.some(([layer]) => layer.id === id)
        ? {}
        : undefined;
    }
    setLayoutProperty(id: string, property: string, value: string) {
      mapSetLayoutProperty(id, property, value);
      return this;
    }
    setPaintProperty(id: string, property: string, value: string) {
      mapSetPaintProperty(id, property, value);
      return this;
    }
    getStyle() {
      return {
        version: 8 as const,
        sources: {},
        layers: [
          { id: "background", type: "background" as const },
          { id: "water", type: "fill" as const, source: "openmaptiles" },
          {
            id: "place-label",
            type: "symbol" as const,
            source: "openmaptiles",
          },
        ],
      };
    }
    remove() {}
    stop() {
      mapStop();
    }
    triggerRepaint() {}
    zoomIn() {
      mapZoomIn();
    }
    zoomOut() {
      mapZoomOut();
    }
    easeTo(options: {
      center: [number, number];
      zoom: number;
      duration: number;
    }) {
      mapEaseTo(options);
    }
    getZoom() {
      return mapGetZoom();
    }
    getCanvas() {
      return mapCanvas;
    }
    dragPan = { disable: mapDragPanDisable, enable: mapDragPanEnable };
    queryRenderedFeatures(
      geometry?:
        | { x: number; y: number }
        | [[number, number], [number, number]],
      options?: { layers?: string[] },
    ) {
      return mapQueryRenderedFeatures(geometry, options);
    }
    querySourceFeatures(sourceId: string, options?: { sourceLayer?: string }) {
      return mapQuerySourceFeatures(sourceId, options);
    }
  },
  setWorkerUrl: vi.fn(),
}));

const roadsId = "roadsquery1234567890ABCD";
const bridgesId = "bridgesquery123456789AB";

const baseConfiguration: MapConfiguration = {
  title: "Transportation comparison",
  basemap: "street",
  worker_url: "https://maps.example/assets/maplibre-gl-worker.mjs",
  layers: [
    {
      query_id: roadsId,
      query_token: "signed-roads",
      layer_name: "Roads",
      tile_url: `https://maps.example/tiles/${roadsId}/{z}/{x}/{y}.mvt`,
      source_layer: "hifld",
      geometry_column: "geometry",
      result_crs: "EPSG:4326",
      initial_bounds: [-80, 35, -75, 40],
      columns: [
        { name: "geometry", type: "GEOMETRY", nullable: false },
        { name: "traffic", type: "INTEGER", nullable: true },
        { name: "kind", type: "VARCHAR", nullable: true },
      ],
      style: { color: "#2166ac", opacity: 0.8 },
      visible: true,
    },
    {
      query_id: bridgesId,
      query_token: "signed-bridges",
      layer_name: "Bridges",
      tile_url: `https://maps.example/tiles/${bridgesId}/{z}/{x}/{y}.mvt`,
      source_layer: "hifld",
      geometry_column: "geometry",
      result_crs: "EPSG:4326",
      columns: [
        { name: "geometry", type: "GEOMETRY", nullable: false },
        { name: "kind", type: "VARCHAR", nullable: true },
      ],
      initial_bounds: [-90, 30, -70, 45],
      visible: false,
    },
  ],
};
const primaryLayer = baseConfiguration.layers[0];
if (primaryLayer === undefined)
  throw new Error("primary layer fixture is missing");

const selectableFeature = (
  overrides: Partial<MockRenderedFeature> = {},
): MockRenderedFeature => ({
  id: 7,
  source: "hifld-query-roadsquery1234567890ABCD",
  sourceLayer: "hifld",
  geometry: { type: "Point", coordinates: [-77, 39] },
  layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
  properties: {
    name: "Route 1",
    __hifld_feature_key: "road-7",
    __hifld_centroid_lng: "-77",
    __hifld_centroid_lat: "39",
  },
  ...overrides,
});

const queryTokens = {
  [roadsId]: "signed-roads",
  [bridgesId]: "signed-bridges",
};

const baseProps: MapViewProps = {
  configuration: baseConfiguration,
  queryTokens,
  app: null,
};

afterEach(() => {
  cleanup();
  mapConstructor.mockClear();
  mapStop.mockClear();
  mapAddSource.mockClear();
  mapAddLayer.mockClear();
  mapSetLayoutProperty.mockClear();
  mapSetPaintProperty.mockClear();
  mapZoomIn.mockClear();
  mapZoomOut.mockClear();
  mapEaseTo.mockClear();
  mapGetZoom.mockReset();
  mapGetZoom.mockReturnValue(6);
  mapQuerySourceFeatures.mockReset();
  mapQuerySourceFeatures.mockReturnValue([]);
  mapQueryRenderedFeatures.mockReset();
  mapQueryRenderedFeatures.mockReturnValue([]);
  mapSetData.mockClear();
  mapIsStyleLoaded.mockReset();
  mapIsStyleLoaded.mockReturnValue(true);
  mapAutoEvents.clear();
  mapAutoEvents.add("load");
  mapAutoEvents.add("idle");
  mapDragPanDisable.mockClear();
  mapDragPanEnable.mockClear();
  mapCanvas.style.cursor = "";
  mapEvents.click = null;
  mapEvents.mousedown = null;
  mapEvents.mousemove = null;
  mapEvents.mouseup = null;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("MapView", () => {
  it("reports the stable tile error body instead of the generic AJAX error", async () => {
    const error = new AJAXError(
      422,
      "Unprocessable Entity",
      `https://maps.example/tiles/${roadsId}/1/0/1.mvt`,
      new Blob([
        JSON.stringify({
          code: "map_not_supported",
          message: "The query result cannot be rendered as a map.",
        }),
      ]),
    );

    await expect(mapErrorMessage(error)).resolves.toBe(
      "The query result cannot be rendered as a map. (map_not_supported)",
    );
  });

  it("adds the token matching a query-ID tile URL only", () => {
    expect(
      mapTileRequest(
        `https://maps.example/tiles/${bridgesId}/2/1/3.mvt`,
        queryTokens,
      ),
    ).toEqual({
      url: `https://maps.example/tiles/${bridgesId}/2/1/3.mvt`,
      headers: { "X-HIFLD-Query-Token": "signed-bridges" },
    });
    expect(
      mapTileRequest(
        "https://tiles.openfreemap.org/styles/bright",
        queryTokens,
      ),
    ).toEqual({ url: "https://tiles.openfreemap.org/styles/bright" });
  });

  it("rejects relative or mismatched layer tile URLs", () => {
    expect(
      normalizeMapConfiguration({
        ...baseConfiguration,
        layers: [{ ...primaryLayer, tile_url: "/tiles/0/0/0.mvt" }],
      }),
    ).toBeNull();
    expect(
      normalizeMapConfiguration({
        ...baseConfiguration,
        layers: [
          {
            ...primaryLayer,
            tile_url: `https://maps.example/tiles/${bridgesId}/{z}/{x}/{y}.mvt`,
          },
        ],
      }),
    ).toBeNull();
  });

  it("combines layer bounds unless the agent supplied a camera", () => {
    expect(initialMapView(baseConfiguration)).toMatchObject({
      bounds: [-90, 30, -70, 45],
      fitBoundsOptions: { padding: 24 },
    });
    expect(
      initialMapView({
        ...baseConfiguration,
        camera: { center: [-77.04, 38.9], zoom: 11 },
      }),
    ).toMatchObject({ center: [-77.04, 38.9], zoom: 11 });
  });

  it("renders sources and geometry layers in query order", () => {
    render(<MapView {...baseProps} />);

    expect(mapAddSource).toHaveBeenNthCalledWith(
      2,
      "hifld-query-roadsquery1234567890ABCD",
      {
        type: "vector",
        tiles: [baseConfiguration.layers[0]?.tile_url],
        minzoom: 0,
        maxzoom: 22,
      },
    );
    expect(mapAddSource).toHaveBeenNthCalledWith(
      3,
      "hifld-query-bridgesquery123456789AB",
      {
        type: "vector",
        tiles: [baseConfiguration.layers[1]?.tile_url],
        minzoom: 0,
        maxzoom: 22,
      },
    );
    expect(mapAddLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hifld-query-roadsquery1234567890ABCD-polygons",
        source: "hifld-query-roadsquery1234567890ABCD",
        paint: expect.objectContaining({ "fill-color": "#2166ac" }),
      }),
      "place-label",
    );
    expect(mapAddLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hifld-query-bridgesquery123456789AB-points",
        source: "hifld-query-bridgesquery123456789AB",
        layout: { visibility: "none" },
      }),
      "place-label",
    );
  });

  it("initializes query layers as soon as the style is ready without waiting for full map load", () => {
    mapAutoEvents.delete("load");

    render(<MapView {...baseProps} />);

    expect(mapAddSource).toHaveBeenCalledWith(
      "hifld-query-roadsquery1234567890ABCD",
      expect.objectContaining({ type: "vector" }),
    );
    expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();
  });

  it("renders one legend group per named layer without an overlaid title", () => {
    render(<MapView {...baseProps} />);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Map legend" })).toBeVisible();
    expect(screen.getByText("Roads")).toBeVisible();
    expect(screen.getByText("Bridges")).toBeVisible();
    expect(screen.getAllByText("All values")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Hide color key" }));
    expect(
      screen.queryByRole("region", { name: "Map legend" }),
    ).not.toBeInTheDocument();
  });

  it("changes the basemap and toggles individual query layers without a style editor", () => {
    render(<MapView {...baseProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to satellite imagery" }),
    );
    expect(mapSetLayoutProperty).toHaveBeenCalledWith(
      "satellite-base",
      "visibility",
      "visible",
    );
    expect(
      screen.getByRole("button", { name: "Switch to street map" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(mapZoomIn).toHaveBeenCalledOnce();
    expect(mapZoomOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("toolbar", { name: "Map controls" })).toHaveClass(
      "map-controls",
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide Roads" }));
    expect(mapSetLayoutProperty).toHaveBeenCalledWith(
      "hifld-query-roadsquery1234567890ABCD-points",
      "visibility",
      "none",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show Bridges" }));
    expect(mapSetLayoutProperty).toHaveBeenCalledWith(
      "hifld-query-bridgesquery123456789AB-points",
      "visibility",
      "visible",
    );
    expect(screen.queryByLabelText("Color Roads by")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Roads opacity")).not.toBeInTheDocument();
  });

  it("applies column styling supplied by the agent", () => {
    mapQuerySourceFeatures.mockReturnValue([
      { properties: { kind: "Interstate", traffic: 10 } },
      { properties: { kind: "Local", traffic: 500 } },
    ]);
    render(
      <MapView
        {...baseProps}
        configuration={{
          ...baseConfiguration,
          layers: [
            {
              ...primaryLayer,
              style: {
                ...primaryLayer.style,
                color_property: "kind",
                color_scheme: "viridis",
                point_radius_property: "traffic",
                point_radius_scale: "sqrt",
              },
            },
          ],
        }}
      />,
    );

    expect(mapSetPaintProperty).toHaveBeenCalledWith(
      "hifld-query-roadsquery1234567890ABCD-points",
      "circle-color",
      expect.arrayContaining(["match"]),
    );
    expect(mapSetPaintProperty).toHaveBeenCalledWith(
      "hifld-query-roadsquery1234567890ABCD-points",
      "circle-radius",
      expect.arrayContaining(["interpolate"]),
    );
    expect(mapQuerySourceFeatures).toHaveBeenCalledWith(
      "hifld-query-roadsquery1234567890ABCD",
      { sourceLayer: "hifld" },
    );
    expect(screen.getByText("Interstate")).toBeVisible();
    expect(screen.getByText("Local")).toBeVisible();
  });

  it("renders clicked details from the normalized feature properties", () => {
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 8,
        source: "hifld-query-bridgesquery123456789AB",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-78, 38] },
        layer: { id: "hifld-query-bridgesquery123456789AB-points" },
        properties: {
          name: "Bay Bridge",
          __hifld_feature_key: "bridge-8",
          __hifld_centroid_lng: "-78",
          __hifld_centroid_lat: "38",
        },
      },
    ]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } } as MapLayerMouseEvent);
    });

    expect(
      screen.getByRole("table", { name: "Selected features" }),
    ).toHaveTextContent("Bay Bridge");
    expect(screen.queryByText("__hifld_feature_key")).not.toBeInTheDocument();
    expect(screen.queryByText("__hifld_centroid_lng")).not.toBeInTheDocument();
    expect(screen.queryByText("__hifld_centroid_lat")).not.toBeInTheDocument();
  });

  it("renders a selected-features table for every non-empty single click", () => {
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });

    const table = screen.getByRole("table", { name: "Selected features" });
    expect(table).toHaveTextContent("Route 1");
    expect(
      screen.getByRole("region", { name: "Dataset map" }),
    ).toContainElement(table);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("opens selected features in a larger resizable drawer", () => {
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });

    const panel = screen.getByRole("region", {
      name: "Selected features panel",
    });
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize selected features panel",
    });
    expect(panel).toHaveStyle({ height: "55%" });
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "55");

    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });

    expect(panel).toHaveStyle({ height: "60%" });
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "60");
  });

  it("zooms to a selected feature when its table row is clicked", () => {
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    fireEvent.click(screen.getByTestId("selected-feature-row"));

    expect(mapEaseTo).toHaveBeenCalledWith({
      center: [-77, 39],
      zoom: 14,
      duration: 500,
    });
  });

  it("renders a row for each feature in a multi-feature box selection", () => {
    mapQueryRenderedFeatures.mockReturnValue([
      selectableFeature(),
      selectableFeature({
        id: 8,
        properties: {
          name: "Route 2",
          __hifld_feature_key: "road-8",
          __hifld_centroid_lng: "-78",
          __hifld_centroid_lat: "38",
        },
      }),
    ]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
      mapEvents.mouseup?.({
        point: { x: 10, y: 20 },
        lngLat: { lng: -78, lat: 38 },
      });
    });

    const table = screen.getByRole("table", { name: "Selected features" });
    expect(table).toHaveTextContent("Route 1");
    expect(table).toHaveTextContent("Route 2");
    expect(screen.getAllByTestId("selected-feature-row")).toHaveLength(2);
  });

  it("marks the table count when the host cannot add selection context", async () => {
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({}),
      updateModelContext: vi.fn(),
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });

    expect(
      screen.getByRole("table", { name: "Selected features" }),
    ).toHaveTextContent("Route 1");
    expect(
      screen.getByText("1 feature highlighted").parentElement,
    ).toHaveTextContent("1 feature highlighted*");
    const contextNote = screen.getByLabelText(
      "The MCP client does not support adding selected features to chat context.",
    );
    const summary = screen.getByTestId("selected-features-summary");
    const clearButton = screen.getByRole("button", {
      name: "Clear selected features",
    });
    expect(summary).toContainElement(screen.getByText("1 feature highlighted"));
    expect(summary).toContainElement(contextNote);
    expect(screen.queryByText("Selected features")).not.toBeInTheDocument();
    expect(contextNote).not.toHaveClass("selected-features-clear");
    expect(clearButton).toHaveClass("selected-features-clear");
    expect(clearButton).not.toHaveTextContent("Clear");
    expect(clearButton.querySelector("svg")).toBeInTheDocument();
    const contextTooltip = screen.getByRole("tooltip");
    expect(contextNote).toHaveTextContent("*");
    expect(contextNote).toHaveAttribute("aria-describedby", contextTooltip.id);
    expect(contextTooltip).toHaveTextContent(
      "The MCP client does not support adding selected features to chat context.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears the table and all selection status with the toolbar eraser", () => {
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear highlighted region" }),
    );

    expect(
      screen.queryByRole("table", { name: "Selected features" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText("0 features highlighted"),
    ).not.toBeInTheDocument();
  });

  it("clears the table and all selection status with its Clear action", () => {
    mapQueryRenderedFeatures.mockReturnValue([selectableFeature()]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear selected features" }),
    );

    expect(
      screen.queryByRole("table", { name: "Selected features" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText("0 features highlighted"),
    ).not.toBeInTheDocument();
  });

  it("replaces the highlighted selection across query layers and publishes it to the host", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
      {
        id: 8,
        source: "hifld-query-bridgesquery123456789AB",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-78, 38] },
        layer: { id: "hifld-query-bridgesquery123456789AB-points" },
        properties: { name: "Bay Bridge", __hifld_feature_key: "bridge-8" },
      },
    ]);
    render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });

    expect(screen.getByText("2 features highlighted")).toBeVisible();
    expect(updateModelContext).toHaveBeenCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({
          map_title: "Transportation comparison",
          selected_feature_count: 2,
          selected_features: expect.arrayContaining([
            expect.objectContaining({ query_id: roadsId }),
            expect.objectContaining({ query_id: bridgesId }),
          ]),
        }),
      },
    });
  });

  it("uses held Shift to persist a box selection and suppresses its synthetic click", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { text: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
      mapEvents.mousemove?.({
        point: { x: 10, y: 20 },
        lngLat: { lng: -78, lat: 38 },
      });
      mapEvents.mouseup?.({
        point: { x: 10, y: 20 },
        lngLat: { lng: -78, lat: 38 },
      });
      mapEvents.click?.({ point: { x: 10, y: 20 } });
    });

    expect(mapDragPanDisable).toHaveBeenCalledOnce();
    expect(mapDragPanEnable).toHaveBeenCalledOnce();
    expect(mapQueryRenderedFeatures).toHaveBeenCalledWith(
      [
        [10, 20],
        [30, 40],
      ],
      {
        layers: expect.arrayContaining([
          "hifld-query-roadsquery1234567890ABCD-points",
        ]),
      },
    );
    expect(mapSetData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: [
          expect.objectContaining({
            geometry: expect.objectContaining({
              coordinates: [
                [
                  [-77, 39],
                  [-78, 39],
                  [-78, 38],
                  [-77, 38],
                  [-77, 39],
                ],
              ],
            }),
          }),
        ],
      }),
    );
    expect(updateModelContext).toHaveBeenCalledOnce();
  });

  it("uses window Shift keys to activate the region control and selection cursor", () => {
    render(<MapView {...baseProps} />);

    expect(
      screen.getByRole("button", { name: "Highlight a region" }),
    ).toBeVisible();
    fireEvent.keyDown(window, { key: "Shift" });

    expect(
      screen.getByRole("button", { name: "Turn off highlight region" }),
    ).toBeVisible();
    expect(mapCanvas.style.cursor).toBe("crosshair");

    fireEvent.keyUp(window, { key: "Shift" });

    expect(
      screen.getByRole("button", { name: "Highlight a region" }),
    ).toBeVisible();
    expect(mapCanvas.style.cursor).toBe("");
  });

  it("hides the clear control until a highlight or box exists", () => {
    render(<MapView {...baseProps} />);

    expect(
      screen.queryByRole("button", { name: "Clear highlighted region" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Shift" });
    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
    });

    expect(
      screen.getByRole("button", { name: "Clear highlighted region" }),
    ).toBeVisible();
  });

  it("removes the selection box source when a normal click replaces box selection", () => {
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
      mapEvents.mouseup?.({
        point: { x: 10, y: 20 },
        lngLat: { lng: -78, lat: 38 },
      });
    });
    expect(mapSetData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: [expect.anything()],
      }),
    );

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });

    expect(mapSetData).toHaveBeenLastCalledWith({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("clears the stale single-feature detail when box highlighting replaces it", () => {
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
      mapEvents.mouseup?.({
        point: { x: 10, y: 20 },
        lngLat: { lng: -78, lat: 38 },
      });
    });

    expect(
      screen.queryByRole("complementary", { name: "Selected feature" }),
    ).not.toBeInTheDocument();
  });

  it("clears the box, highlighted features, and host context", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear highlighted region" }),
      );
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mapSetData).toHaveBeenLastCalledWith({
      type: "FeatureCollection",
      features: [],
    });
    expect(updateModelContext).toHaveBeenLastCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({ selected_feature_count: 0 }),
      },
    });
  });

  it("overwrites prior highlight context when a new map configuration arrives", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    const { rerender, unmount } = render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    rerender(
      <MapView
        {...baseProps}
        app={app}
        configuration={{ ...baseConfiguration, title: "Replacement map" }}
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Selected feature" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear highlighted region" }),
    ).not.toBeInTheDocument();
    expect(updateModelContext).toHaveBeenCalledTimes(2);
    expect(updateModelContext).toHaveBeenLastCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({
          map_title: "Replacement map",
          selected_feature_count: 0,
          selection_bounds: null,
        }),
      },
    });
    await act(async () => {});
    unmount();
    expect(updateModelContext).toHaveBeenCalledTimes(2);
  });

  it("clears published highlight context when the map view unmounts", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    const { unmount } = render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    unmount();

    expect(updateModelContext).toHaveBeenCalledTimes(2);
    expect(updateModelContext).toHaveBeenLastCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({
          selected_feature_count: 0,
          selection_bounds: null,
        }),
      },
    });
  });

  it("does not publish empty context when an unselected map view unmounts", () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    const { unmount } = render(<MapView {...baseProps} app={app} />);

    unmount();

    expect(updateModelContext).not.toHaveBeenCalled();
  });

  it("keeps the latest context status when an earlier update settles later", async () => {
    const pending: Array<{
      resolve: (value: ModelContextUpdateResult) => void;
      reject: (reason: Error) => void;
    }> = [];
    const updateModelContext = vi.fn(
      () =>
        new Promise<ModelContextUpdateResult>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({ updateModelContext: { text: {} } }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    render(<MapView {...baseProps} app={app} />);

    act(() => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
      mapEvents.click?.({ point: { x: 2, y: 2 } });
    });
    const first = pending[0];
    const second = pending[1];
    if (!first || !second) throw new Error("context updates were not queued");

    await act(async () => {
      second.resolve({});
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      first.reject(new Error("stale host failure"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an error status when clearing highlight context is rejected", async () => {
    const updateModelContext = vi.fn().mockRejectedValue(new Error("rejected"));
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear highlighted region" }),
      );
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Highlight cleared locally, but the host context could not be cleared. The prior selection may remain available to the agent.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "0 features highlighted",
    );
  });

  it("retries a rejected context clear when the map view unmounts", async () => {
    const updateModelContext = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("rejected clear"))
      .mockResolvedValueOnce({});
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    const { unmount } = render(<MapView {...baseProps} app={app} />);

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear highlighted region" }),
      );
    });
    unmount();

    expect(updateModelContext).toHaveBeenCalledTimes(3);
    expect(updateModelContext).toHaveBeenLastCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({ selected_feature_count: 0 }),
      },
    });
  });

  it("clears published context through the MCP resource teardown handler", async () => {
    const updateModelContext = vi.fn().mockResolvedValue({});
    const teardownHandlers: Array<() => Promise<void>> = [];
    const registerTeardownHandler = vi.fn(
      (handler: (() => Promise<void>) | null) => {
        if (handler) teardownHandlers.push(handler);
        return () => {
          teardownHandlers.length = 0;
        };
      },
    );
    const app = {
      getHostContext: () => ({}),
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext,
    } satisfies NonNullable<MapViewProps["app"]>;
    mapQueryRenderedFeatures.mockReturnValue([
      {
        id: 7,
        source: "hifld-query-roadsquery1234567890ABCD",
        sourceLayer: "hifld",
        geometry: { type: "Point", coordinates: [-77, 39] },
        layer: { id: "hifld-query-roadsquery1234567890ABCD-points" },
        properties: { name: "Route 1", __hifld_feature_key: "road-7" },
      },
    ]);
    render(
      <MapView
        {...baseProps}
        app={app}
        registerTeardownHandler={registerTeardownHandler}
      />,
    );

    await act(async () => {
      mapEvents.click?.({ point: { x: 1, y: 1 } });
    });
    const registered = teardownHandlers[0];
    if (!registered) throw new Error("resource teardown handler was not set");
    await act(async () => {
      await registered();
    });

    expect(updateModelContext).toHaveBeenCalledTimes(2);
    expect(updateModelContext).toHaveBeenLastCalledWith({
      structuredContent: {
        map_highlight: expect.objectContaining({ selected_feature_count: 0 }),
      },
    });
  });

  it("cancels a box drag released outside the map and restores drag pan", () => {
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
    });
    fireEvent.mouseUp(window);

    expect(mapDragPanEnable).toHaveBeenCalledOnce();
    expect(mapSetData).toHaveBeenLastCalledWith({
      type: "FeatureCollection",
      features: [],
    });
    expect(
      screen.queryByRole("button", { name: "Clear highlighted region" }),
    ).not.toBeInTheDocument();
  });

  it("cancels an active box drag when the map window loses focus", () => {
    render(<MapView {...baseProps} />);

    fireEvent.keyDown(window, { key: "Shift" });
    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
    });
    fireEvent.blur(window);

    expect(mapDragPanEnable).toHaveBeenCalledOnce();
    expect(mapSetData).toHaveBeenLastCalledWith({
      type: "FeatureCollection",
      features: [],
    });
    expect(
      screen.getByRole("button", { name: "Highlight a region" }),
    ).toBeVisible();
    expect(mapCanvas.style.cursor).toBe("");
  });

  it("re-enables drag pan when clearing an active box drag", () => {
    render(<MapView {...baseProps} />);

    act(() => {
      mapEvents.mousedown?.({
        point: { x: 30, y: 40 },
        lngLat: { lng: -77, lat: 39 },
        originalEvent: { shiftKey: true },
        preventDefault: vi.fn(),
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear highlighted region" }),
    );

    expect(mapDragPanEnable).toHaveBeenCalledOnce();
  });

  it("copies the webapp satellite imagery mode with multiple overlays", () => {
    render(
      <MapView
        {...baseProps}
        configuration={{ ...baseConfiguration, basemap: "satellite" }}
      />,
    );

    const options = mapConstructor.mock.calls[0]?.[0];
    expect(options.style).toBe("https://tiles.openfreemap.org/styles/bright");
    expect(mapAddSource).toHaveBeenCalledWith("esri-world-imagery", {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
    expect(mapSetLayoutProperty).toHaveBeenCalledWith(
      "satellite-base",
      "visibility",
      "visible",
    );
  });

  it("pauses rendering while the document is hidden", () => {
    render(<MapView {...baseProps} />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(mapStop).toHaveBeenCalledOnce();
  });
});
