import type { DatasetSource } from "@/lib/api-client";

export interface GeoparquetTreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children: GeoparquetTreeNode[];
  source?: DatasetSource;
}

function isFileLocation(location: DatasetSource["location"]): location is { path: string } {
  return typeof location === "object" && location !== null && "path" in location;
}

export function getSourcePath(source: DatasetSource): string | null {
  if (!isFileLocation(source.location)) {
    return null;
  }
  return source.location.path || null;
}

export function formatGeoparquetGlobLabel(globPattern: string): string {
  return globPattern.includes("**/") ? "**/*.parquet (glob)" : "*.parquet (glob)";
}

function relativeGeoparquetPath(path: string): string {
  const marker = "/geoparquet/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex >= 0) {
    return path.slice(markerIndex + marker.length);
  }

  const parts = path.split("/").filter(Boolean);
  const formatIndex = parts.indexOf("geoparquet");
  return formatIndex >= 0 ? parts.slice(formatIndex + 1).join("/") : parts.at(-1) || path;
}

function getOrCreateFolder(
  siblings: GeoparquetTreeNode[],
  name: string,
  path: string,
): GeoparquetTreeNode {
  const existing = siblings.find(
    (node) => node.type === "folder" && node.name === name,
  );
  if (existing) {
    return existing;
  }

  const folder: GeoparquetTreeNode = {
    name,
    path,
    type: "folder",
    children: [],
  };
  siblings.push(folder);
  siblings.sort((a, b) => a.name.localeCompare(b.name));
  return folder;
}

export function buildGeoparquetSourceTree(
  sources: DatasetSource[],
): GeoparquetTreeNode[] {
  const root: GeoparquetTreeNode[] = [];
  const seenPaths = new Set<string>();

  for (const source of sources) {
    const path = getSourcePath(source);
    if (!path || path.includes("*") || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);

    const relativePath = relativeGeoparquetPath(path);
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let siblings = root;
    let currentPath = "";
    for (const folderName of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      const folder = getOrCreateFolder(siblings, folderName, currentPath);
      siblings = folder.children;
    }

    const fileName = parts.at(-1) || path.split("/").pop() || "file.parquet";
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
    siblings.push({
      name: fileName,
      path: filePath,
      type: "file",
      children: [],
      source,
    });
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }

  return root;
}
