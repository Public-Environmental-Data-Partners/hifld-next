import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetFile, DatasetFormat, DatasetSource } from "@/lib/api-client";
import { FileFormatTree } from "../FileFormatTree";
import { PMTilesFormat } from "../PMTilesFormat";

const { trackUrlCopied } = vi.hoisted(() => ({ trackUrlCopied: vi.fn() }));
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackUrlCopied,
}));
vi.mock("../DownloadButton", () => ({
  DownloadButton: ({ url, label }: { url: string; label: string }) => <a href={url}>{label}</a>,
}));

const timestamp = "2026-05-24T14:30:00Z";
const storageLocation = { id: 5, name: "public", backend_type: "s3" as const, created_at: timestamp, updated_at: timestamp };
const writeText = vi.fn();

function format(formatType: string, sources: DatasetSource[]): DatasetFormat {
  return {
    format: { id: 1, format_type: formatType, name: formatType, created_at: timestamp, updated_at: timestamp },
    sources,
  };
}

function source(path: string, extra: Partial<DatasetSource> = {}): DatasetSource {
  return {
    id: 1,
    version: "v1",
    source_type: "file",
    location: { version: "v1", path },
    storage_location: storageLocation,
    ...extra,
  };
}

function file(formats: DatasetFormat[]): DatasetFile {
  return {
    id: "file-1",
    dataset_id: "dataset-1",
    name: "Hospitals",
    slug: "hospital-points",
    created_at: timestamp,
    updated_at: timestamp,
    formats,
  };
}

function renderTree(formats: DatasetFormat[]) {
  render(
    <FileFormatTree
      file={file(formats)}
      selectedSources={{}}
      onSourceChange={vi.fn()}
      pmtilesUrl={null}
      collectionSlug="hifld"
      datasetSlug="hospitals"
      fileSlug="hospital-points"
    />,
  );
}

const fileContext = { collectionSlug: "hifld", datasetSlug: "hospitals", fileSlug: "hospital-points" };

describe("copy analytics from format call sites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.history.pushState({}, "", "/collections/hifld/datasets/hospitals");
  });

  it("labels an HTTPS download link with its format and file", async () => {
    const url = "https://objects.example.test/hospitals.gpkg?token=private";
    renderTree([format("geopackage", [source("h/v1/geopackage/hospitals.gpkg", { url })])]);
    fireEvent.click(screen.getByRole("button", { name: /geopackage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(trackUrlCopied).toHaveBeenCalledWith({ ...fileContext, urlType: "download_url", format: "geopackage" }),
    );
    expect(writeText).toHaveBeenCalledWith(url);
    expect(JSON.stringify(trackUrlCopied.mock.calls)).not.toContain("private");
  });

  it("labels storage URIs and DuckDB config separately", async () => {
    const glob = "s3://bucket/h/v1/geoparquet/*.parquet?endpoint_url=http://storage.test:8333";
    renderTree([format("geoparquet", [source("h/v1/geoparquet/*.parquet", { glob_pattern: glob })])]);
    fireEvent.click(screen.getByRole("button", { name: /^geoparquet/ }));
    const globNode = screen.getAllByRole("button", { expanded: false })[0];
    if (!globNode) throw new Error("Missing glob node");
    fireEvent.click(globNode);

    fireEvent.click(screen.getByRole("button", { name: "Copy DuckDB Config" }));
    await waitFor(() =>
      expect(trackUrlCopied).toHaveBeenLastCalledWith({ ...fileContext, urlType: "duckdb_config", format: "geoparquet" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy URI" }));
    await waitFor(() =>
      expect(trackUrlCopied).toHaveBeenLastCalledWith({ ...fileContext, urlType: "storage_uri", format: "geoparquet" }),
    );
  });

  it("labels catalog object links with the surrounding file", async () => {
    const object = {
      object_key: "hospitals.csv",
      relative_path: "csv/hospitals.csv",
      size_bytes: 10,
      sha256: null,
      checksum_multihash: null,
      storage_revision: null,
      url: "https://objects.example.test/hospitals.csv",
    };
    renderTree([format("csv", [source("h/v1/csv/hospitals.csv", { objects: [object] })])]);
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    fireEvent.click(screen.getByRole("button", { name: /hospitals\.csv/ }));
    fireEvent.click(within(screen.getByText(object.url).parentElement ?? document.body).getByRole("button", { name: "Copy URL" }));

    await waitFor(() =>
      expect(trackUrlCopied).toHaveBeenCalledWith({ ...fileContext, urlType: "download_url", format: "csv" }),
    );
  });

  it("falls back to page context where the caller has no file context", async () => {
    render(
      <PMTilesFormat
        formatEntry={format("pmtiles", [source("h/v1/pmtiles/hospitals.pmtiles")])}
        pmtilesUrl="https://objects.example.test/hospitals.pmtiles"
        selectedSource={null}
        onSourceChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "URL" }));

    await waitFor(() =>
      expect(trackUrlCopied).toHaveBeenCalledWith({
        collectionSlug: "hifld",
        datasetSlug: "hospitals",
        fileSlug: undefined,
        urlType: "download_url",
        format: "pmtiles",
      }),
    );
  });
});
