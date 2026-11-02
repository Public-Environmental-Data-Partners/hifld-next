import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DatasetFormat } from "@/lib/api-client";
import { FileFormatTree } from "../FileFormatTree";

vi.mock("../DownloadButton", () => ({
  DownloadButton: ({ url, label }: { url: string; label: string }) => <a href={url}>{label}</a>,
}));

const file = (formats: DatasetFormat[]) => ({
  id: "file", dataset_id: "dataset", name: "File", slug: "file", created_at: "", updated_at: "", formats,
});

it("shows every indexed JSON object inside its format node with size and checksum", () => {
  const format: DatasetFormat = {
    format: { id: "json", format_type: "json", name: "JSON", created_at: "", updated_at: "" },
    sources: [{
      id: "v1/raw", asset_key: "raw", version: "v1", source_type: "file", location: { version: "v1", path: "" },
      objects: ["a", "b"].map((folder) => ({
        object_key: `data/raw/${folder}/same.json`, relative_path: `raw/${folder}/same.json`, size_bytes: 12,
        sha256: `checksum-${folder}`, checksum_multihash: null, storage_revision: null,
        url: `https://objects.example/data/raw/${folder}/same.json`,
      })),
    }],
  };
  const { container } = render(<FileFormatTree file={file([format])} selectedSources={{}} onSourceChange={vi.fn()} pmtilesUrl={null} />);
  expect(screen.queryByText("All files")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /json/i }));
  fireEvent.click(screen.getByRole("button", { name: /^raw/ }));
  fireEvent.click(screen.getByRole("button", { name: /^a/ }));
  fireEvent.click(screen.getByRole("button", { name: /^b/ }));
  for (const button of screen.getAllByRole("button", { name: /same\.json/ })) fireEvent.click(button);

  expect(within(container).getAllByText("same.json")).toHaveLength(2);
  expect(within(container).getByText("raw")).toBeInTheDocument();
  expect(within(container).getByText("a")).toBeInTheDocument();
  expect(within(container).getByText("b")).toBeInTheDocument();
  expect(within(container).getAllByText("12 B")).toHaveLength(2);
  expect(within(container).getByText("checksum-a")).toBeInTheDocument();
  expect(within(container).getAllByRole("link", { name: "Download", hidden: true }).map((link) => link.getAttribute("href"))).toEqual([
    "https://objects.example/data/raw/a/same.json", "https://objects.example/data/raw/b/same.json",
  ]);
  expect(within(container).queryByText("View Data")).not.toBeInTheDocument();
});

it("combines same-format assets from the selected version and location", () => {
  const format: DatasetFormat = {
    format: { id: "json", format_type: "json", name: "JSON", created_at: "", updated_at: "" },
    sources: ["a", "b"].map((folder) => ({
      id: `v1/hash-${folder}`, asset_key: `hash-${folder}`, version: "v1", source_type: "file",
      location: { version: "v1", path: "" },
      storage_location: { id: "published", name: "Published", backend_type: "s3", created_at: "", updated_at: "" },
      objects: [{ object_key: `data/raw/${folder}/same.json`, relative_path: `raw/${folder}/same.json`,
        size_bytes: 12, sha256: null, checksum_multihash: null, storage_revision: null,
        url: `https://objects.example/data/raw/${folder}/same.json` }],
    })),
  };
  const { container } = render(<FileFormatTree file={file([format])} selectedSources={{}} onSourceChange={vi.fn()} pmtilesUrl={null} />);
  fireEvent.click(screen.getByRole("button", { name: /json/i }));
  fireEvent.click(screen.getByRole("button", { name: /^raw/ }));
  fireEvent.click(screen.getByRole("button", { name: /^a/ }));
  fireEvent.click(screen.getByRole("button", { name: /^b/ }));
  for (const button of screen.getAllByRole("button", { name: /same\.json/ })) fireEvent.click(button);
  expect(within(container).getAllByText("same.json")).toHaveLength(2);
  expect(within(container).getByText(/Published/)).toBeInTheDocument();
  expect(within(container).queryByText(/hash-/)).not.toBeInTheDocument();
  expect(within(container).queryByText("All files")).not.toBeInTheDocument();
});

it("renders unknown formats as peers in the format tree", () => {
  const format: DatasetFormat = {
    format: { id: "yaml", format_type: "yaml_config", name: "YAML config", created_at: "", updated_at: "" },
    sources: [{
      id: "yaml-v2", version: "v2", source_type: "file", location: { version: "v2", path: "configs/service.yaml" },
      url: "https://objects.example/configs/service.yaml",
      objects: [{ object_key: "configs/service.yaml", relative_path: "service.yaml", size_bytes: 4, sha256: null,
        checksum_multihash: null, storage_revision: null, url: "https://objects.example/configs/service.yaml" }],
    }],
  };
  render(<FileFormatTree file={file([format])} selectedSources={{}} onSourceChange={vi.fn()} pmtilesUrl={null} />);
  expect(screen.getByRole("button", { name: /yaml config/i })).toBeInTheDocument();
  expect(screen.queryByText("All files")).not.toBeInTheDocument();
});

it("keeps known format controls, exposes unrepresented objects, and avoids URL duplicates", () => {
  const format: DatasetFormat = {
    format: { id: "geojson", format_type: "geojson", name: "GeoJSON", created_at: "", updated_at: "" },
    sources: [{
      id: "geojson-v1", version: "v1", source_type: "file", location: { version: "v1", path: "data/primary.geojson" },
      url: "https://objects.example/data/primary.geojson", sha256: "source-checksum",
      objects: [
        { object_key: "data/primary.geojson", relative_path: "geojson/primary.geojson", size_bytes: 9, sha256: "object-checksum",
          checksum_multihash: null, storage_revision: null, url: "https://objects.example/data/primary.geojson" },
        { object_key: "data/sidecars/extra.txt", relative_path: "geojson/sidecars/extra.txt", size_bytes: 5, sha256: null,
          checksum_multihash: null, storage_revision: null, url: "https://objects.example/data/sidecars/extra.txt" },
      ],
    }],
  };
  const { container } = render(<FileFormatTree file={file([format])} selectedSources={{}} onSourceChange={vi.fn()} pmtilesUrl={null} />);
  fireEvent.click(screen.getByRole("button", { name: /geojson/i }));
  expect(within(container).getByText("source-checksum")).toBeInTheDocument();
  expect(within(container).getAllByText("https://objects.example/data/primary.geojson")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /^sidecars/ }));
  expect(within(container).getByRole("button", { name: /extra\.txt/ })).toBeInTheDocument();
});

it("uses the version shown first by the selector when no version was selected", () => {
  const format: DatasetFormat = {
    format: { id: "json", format_type: "json", name: "JSON", created_at: "", updated_at: "" },
    sources: ["v1.0", "v2.0"].map((version) => ({
      id: version, version, source_type: "file" as const, location: { version, path: "" },
      storage_location: { id: "published", name: "Published", backend_type: "s3" as const, created_at: "", updated_at: "" },
      objects: [{ object_key: `${version}/data.json`, relative_path: `${version}/data.json`, size_bytes: 10, sha256: null,
        checksum_multihash: null, storage_revision: null, url: `https://objects.example/${version}/data.json` }],
    })),
  };
  const { container } = render(<FileFormatTree file={file([format])} selectedSources={{}} onSourceChange={vi.fn()} pmtilesUrl={null} />);
  fireEvent.click(screen.getByRole("button", { name: /json/i }));
  expect(within(container).getByRole("combobox").textContent).toContain("v2.0");
  expect(within(container).queryByText("v1.0")).not.toBeInTheDocument();
  expect(within(container).getByRole("button", { name: /^v2\.0/ })).toBeInTheDocument();
});
