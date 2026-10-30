import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DatasetFormat } from "@/lib/api-client";
import { FileFormatTree } from "../FileFormatTree";

vi.mock("../DownloadButton", () => ({
  DownloadButton: ({ url, label }: { url: string; label: string }) => <a href={url}>{label}</a>,
}));

it("shows every indexed JSON object beneath its nested path with size and checksum", () => {
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
  render(<FileFormatTree file={{ id: "file", dataset_id: "dataset", name: "File", slug: "file", created_at: "", updated_at: "", formats: [format] }} selectedSources={{}} onSourceChange={vi.fn()} />);
  const files = screen.getByRole("region", { name: "Catalog files" });
  expect(within(files).getAllByText("same.json")).toHaveLength(2);
  expect(within(files).getByText("raw")).toBeInTheDocument();
  expect(within(files).getByText("a")).toBeInTheDocument();
  expect(within(files).getByText("b")).toBeInTheDocument();
  expect(within(files).getAllByText("12 B")).toHaveLength(2);
  expect(within(files).getByText("checksum-a")).toBeInTheDocument();
  expect(within(files).getAllByRole("link", { name: "Download", hidden: true }).map((link) => link.getAttribute("href"))).toEqual([
    "https://objects.example/data/raw/a/same.json", "https://objects.example/data/raw/b/same.json",
  ]);
  expect(within(files).queryByText("View Data")).not.toBeInTheDocument();
});


it("combines JSON assets into one collapsed version and location tree", () => {
  const format: DatasetFormat = {
    format: { id: "json", format_type: "json", name: "part-00000.json", created_at: "", updated_at: "" },
    sources: ["a", "b"].map((folder) => ({
      id: `v1/hash-${folder}`, asset_key: `hash-${folder}`, version: "v1", source_type: "file",
      location: { version: "v1", path: "" },
      storage_location: { id: "published", name: "Published", backend_type: "s3", created_at: "", updated_at: "" },
      objects: [{ object_key: `data/raw/${folder}/same.json`, relative_path: `raw/${folder}/same.json`,
        size_bytes: 12, sha256: null, checksum_multihash: null, storage_revision: null,
        url: `https://objects.example/data/raw/${folder}/same.json` }],
    })),
  };
  const { container } = render(<FileFormatTree file={{ id: "file", dataset_id: "dataset", name: "File", slug: "file", created_at: "", updated_at: "", formats: [format] }} selectedSources={{}} onSourceChange={vi.fn()} />);
  const files = screen.getByRole("region", { name: "Catalog files" });
  expect(within(files).getByText("All files")).toBeInTheDocument();
  expect(within(files).getAllByText("raw")).toHaveLength(1);
  expect(within(files).getAllByText("JSON")).toHaveLength(1);
  expect(within(files).getAllByText("v1 · Published")).toHaveLength(1);
  expect(within(files).getAllByText("same.json")).toHaveLength(2);
  expect(within(files).queryByText(/hash-/)).not.toBeInTheDocument();
  expect(within(files).queryByText("part-00000.json")).not.toBeInTheDocument();
  expect(container.querySelectorAll("details[open]")).toHaveLength(0);
  expect(within(files).getAllByText("12 B").every((size) => size.closest("summary"))).toBe(true);
});
