import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
const init = vi.fn((_key: string, options: { loaded?: (posthog: unknown) => void }) => {
  options.loaded?.({ capture });
});

vi.mock("posthog-js", () => ({
  default: {
    init,
    capture,
  },
}));

describe("analytics", () => {
  beforeEach(async () => {
    capture.mockClear();
    init.mockClear();
    vi.resetModules();
    window.__HIFLD_CLIENT_CONFIG__ = {
      posthogKey: "ph_runtime",
      posthogHost: "https://posthog-runtime.test",
    };
  });

  it("initializes PostHog from runtime client config", async () => {
    const { trackPageView } = await import("../analytics");

    trackPageView("/collections");

    expect(init).toHaveBeenCalledWith(
      "ph_runtime",
      expect.objectContaining({
        api_host: "https://posthog-runtime.test",
        cookieless_mode: "always",
        persistence: "memory",
        person_profiles: "never",
        disable_session_recording: true,
        autocapture: false,
        enable_heatmaps: false,
      }),
    );
    expect(capture).toHaveBeenCalledWith("$pageview", expect.objectContaining({ path: "/collections" }));
  });

  it("tracks a zero-result search query", async () => {
    const { trackSearchQuery } = await import("../analytics");

    trackSearchQuery("hospital", "hifld", 0);

    expect(capture).toHaveBeenCalledWith("dataset_search", {
      query: "hospital",
      query_suppressed: false,
      query_length: 8,
      collection_slug: "hifld",
      result_count: 0,
      has_tag_filters: false,
      is_zero_result: true,
    });
  });

  it("tracks a zero-result tag filter with its resolved count", async () => {
    const { trackTagFilter } = await import("../analytics");

    trackTagFilter("hifld", "geometry_type", ["Point"], 0, "hospital");

    expect(capture).toHaveBeenCalledWith("tag_filter_applied", {
      collection_slug: "hifld",
      filter_key: "geometry_type",
      filter_values: ["Point"],
      result_count: 0,
      is_zero_result: true,
    });
  });

  it("tracks a download click without full URLs or undefined fields", async () => {
    const { trackDownloadClicked } = await import("../analytics");

    trackDownloadClicked({
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      source_id: 42,
      storage_location_id: 7,
      version: "v1",
      expected_size_bytes: 1234,
      filename: "runways.parquet",
      url_host: "storage.googleapis.com",
      download_method: "native_link",
    });

    expect(capture).toHaveBeenCalledWith("dataset_download_clicked", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      source_id: 42,
      storage_location_id: 7,
      version: "v1",
      expected_size_bytes: 1234,
      filename: "runways.parquet",
      url_host: "storage.googleapis.com",
      download_method: "native_link",
    });
  });

  it("tracks download success with byte counts and duration", async () => {
    const { trackDownloadSucceeded } = await import("../analytics");

    trackDownloadSucceeded(
      {
        collection_slug: "hifld",
        dataset_slug: "airport-runways",
        file_slug: "runways",
        format: "geoparquet",
        download_method: "fetch_stream",
      },
      {
        completion_status: "completed",
        received_bytes: 20,
        content_length_bytes: 20,
        duration_ms: 125,
      },
    );

    expect(capture).toHaveBeenCalledWith("dataset_download_succeeded", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      download_method: "fetch_stream",
      completion_status: "completed",
      received_bytes: 20,
      content_length_bytes: 20,
      duration_ms: 125,
    });
  });

  it("tracks a download handoff with duration only", async () => {
    const { trackDownloadHandedOff } = await import("../analytics");

    trackDownloadHandedOff(
      {
        collection_slug: "hifld",
        dataset_slug: "airport-runways",
        file_slug: "runways",
        format: "geoparquet",
        download_method: "native_link",
      },
      { duration_ms: 125 },
    );

    expect(capture).toHaveBeenCalledWith("dataset_download_handed_off", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      download_method: "native_link",
      duration_ms: 125,
    });
  });

  it("tracks download failure with a bounded error category", async () => {
    const { trackDownloadFailed } = await import("../analytics");

    trackDownloadFailed(
      {
        collection_slug: "hifld",
        dataset_slug: "airport-runways",
        file_slug: "runways",
        format: "geoparquet",
        download_method: "fetch_stream",
      },
      {
        error_category: "http_error",
        received_bytes: 5,
        content_length_bytes: 10,
        duration_ms: 90,
      },
    );

    expect(capture).toHaveBeenCalledWith("dataset_download_failed", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      download_method: "fetch_stream",
      error_category: "http_error",
      received_bytes: 5,
      content_length_bytes: 10,
      duration_ms: 90,
    });
  });

  it("tracks a dataset map import with only source and layer metadata", async () => {
    const { trackDatasetImportedIntoMap } = await import("../analytics");

    trackDatasetImportedIntoMap({
      collection_slug: "hifld",
      dataset_slug: "hospitals",
      file_slug: "hospitals",
      source_id: 15,
      version: "v1.0.0",
      import_source: "route",
      loaded_layer_count: 2,
    });

    expect(capture).toHaveBeenCalledWith("dataset_imported_into_map", {
      collection_slug: "hifld",
      dataset_slug: "hospitals",
      file_slug: "hospitals",
      source_id: 15,
      version: "v1.0.0",
      import_source: "route",
      loaded_layer_count: 2,
    });
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("feature_id");
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("feature_properties");
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("coordinates");
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("source_url");
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("map_viewport");
  });

  it("tracks WebMCP lifecycle events with bounded properties only", async () => {
    const {
      trackWebMcpToolStarted,
      trackWebMcpToolCompleted,
      trackWebMcpToolFailed,
      webMcpAnalyticsProperties,
    } = await import("../analytics");

    trackWebMcpToolStarted("get_dataset", "catalog");
    trackWebMcpToolCompleted("get_dataset", "catalog", 125, 3);
    trackWebMcpToolFailed("get_dataset", "catalog", 2_500, "invalid_request");

    expect(capture).toHaveBeenNthCalledWith(1, "webmcp_tool_started", {
      tool_name: "get_dataset",
      route_kind: "catalog",
    });
    expect(capture).toHaveBeenNthCalledWith(2, "webmcp_tool_completed", {
      tool_name: "get_dataset",
      route_kind: "catalog",
      duration_bucket: "100_499ms",
      result_count_bucket: "1_9",
    });
    expect(capture).toHaveBeenNthCalledWith(3, "webmcp_tool_failed", {
      tool_name: "get_dataset",
      route_kind: "catalog",
      duration_bucket: "2000ms_plus",
      error_code: "invalid_request",
    });

    const noisy: Parameters<typeof webMcpAnalyticsProperties>[0] & {
      sql: string;
      token: string;
      url: string;
      source_id: number;
      rows: string[];
      geometry: string;
      stack: string;
    } = {
      tool_name: "get_dataset",
      route_kind: "catalog",
      sql: "SELECT secret",
      token: "private-token",
      url: "https://private.example",
      source_id: 42,
      rows: ["row"],
      geometry: "POINT(0 0)",
      stack: "Error: secret",
    };
    expect(webMcpAnalyticsProperties(noisy)).toEqual({
      tool_name: "get_dataset",
      route_kind: "catalog",
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    capture.mockImplementationOnce(() => {
      throw new Error("SQL secret token stack");
    });
    trackWebMcpToolStarted("get_dataset", "catalog");
    expect(consoleError).toHaveBeenCalledWith("Failed to track WebMCP analytics event.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SQL secret token stack");
    consoleError.mockRestore();
  });
});

it("strips URL queries at the final SDK boundary and honors GPC", async () => {
 const {trackPageView} = await import("../analytics");
 trackPageView("/collections?email=private#secret");
 expect(capture).toHaveBeenCalledWith("$pageview",expect.objectContaining({path:"/collections"}));
 const beforeSend = init.mock.calls.at(-1)?.[1].before_send;
 const event = {event:"$pageview", $set_once:{$initial_current_url:"https://data.test/?secret=1"}, properties:{$current_url:"https://data.test/?token=secret",$referrer:"https://search.test/?q=private",$set:{email:"private@example.com"}}};
 expect(beforeSend?.(event)).toMatchObject({properties:{$current_url:"https://data.test/",$referrer:"https://search.test/"}});
 expect(beforeSend?.(event)?.properties).not.toHaveProperty("$set");
 expect(beforeSend?.(event)).not.toHaveProperty("$set_once");
 Object.defineProperty(navigator,"globalPrivacyControl",{configurable:true,value:true});
 expect(beforeSend?.(event)).toBeNull();
 Reflect.deleteProperty(navigator,"globalPrivacyControl");
});

it("keeps novel zero-result terms and filters sensitive text at the SDK boundary", async () => {
  const {trackSearchQuery} = await import("../analytics");
  capture.mockClear();
  trackSearchQuery("tribal broadband availability", "hifld", 0);
  expect(capture).toHaveBeenCalledWith("dataset_search",expect.objectContaining({query:"tribal broadband availability",is_zero_result:true,query_suppressed:false}));
  trackSearchQuery("analyst@example.com", "hifld", 0);
  expect(capture.mock.calls.at(-1)?.[1]).not.toHaveProperty("query");
  expect(capture.mock.calls.at(-1)?.[1]).toMatchObject({result_count:0,query_suppressed:true});
  const beforeSend = init.mock.calls.at(-1)?.[1].before_send;
  expect(beforeSend?.({event:"dataset_search",properties:{query:"Substations",search_query:"private"}}).properties).toEqual({query:"substations"});
  expect(beforeSend?.({event:"dataset_search",properties:{query:"analyst@example.com"}}).properties).not.toHaveProperty("query");
  expect(beforeSend?.({event:"$pageview",properties:{query:"substations"}}).properties).not.toHaveProperty("query");
});
