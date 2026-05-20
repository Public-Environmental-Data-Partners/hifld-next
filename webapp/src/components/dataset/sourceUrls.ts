import type { DatasetSource, FileLocation } from "@/lib/api-client";

function isFileLocation(location: DatasetSource["location"]): location is FileLocation {
  return "path" in location;
}

function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function buildBucketFileUrl(
  baseUrl: string,
  path: string,
  config: Record<string, unknown>
): string {
  const bucket = typeof config.bucket === "string" ? config.bucket : null;
  if (config.type === "seaweedfs" && bucket) {
    return joinUrlPath(baseUrl, `buckets/${bucket}/${path}`);
  }

  return joinUrlPath(baseUrl, path);
}

function pathToGlob(path: string, extension: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanPath.includes("*")) {
    return cleanPath;
  }
  const lastSlash = cleanPath.lastIndexOf("/");
  const globName = `*.${extension.replace(/^\./, "")}`;
  return lastSlash === -1
    ? globName
    : `${cleanPath.slice(0, lastSlash + 1)}${globName}`;
}

function replaceStorageUriPath(storageUri: string, path: string): string {
  const [uriPart, queryPart] = storageUri.split("?");
  const match = uriPart.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)(?:\/.*)?$/i);
  if (!match) {
    return storageUri;
  }

  const nextUri = `${match[1]}/${path.replace(/^\/+/, "")}`;
  return queryPart ? `${nextUri}?${queryPart}` : nextUri;
}

export function buildSourceFileUrl(source: DatasetSource): string | null {
  if (source.source_type === "api" && "url" in source.location) {
    return source.location.url;
  }

  if (source.source_type !== "file" || !isFileLocation(source.location)) {
    return source.url ?? null;
  }

  const path = source.location.path;
  const config = source.storage_location?.config as Record<string, unknown> | undefined;
  const baseUrl = typeof config?.base_url === "string" ? config.base_url : null;

  if (!path || path.includes("*")) {
    return null;
  }

  if (baseUrl && config) {
    return buildBucketFileUrl(baseUrl, path, config);
  }

  return source.url ?? null;
}

export function buildSourceStorageUri(
  source: DatasetSource,
  options: { globExtension?: string } = {}
): string | null {
  if (source.source_type !== "file" || !isFileLocation(source.location)) {
    return source.storage_uri ?? null;
  }

  const sourcePath = source.location.path;
  if (!sourcePath) {
    return null;
  }

  const uriPath = options.globExtension
    ? pathToGlob(sourcePath, options.globExtension)
    : sourcePath.replace(/^\/+/, "");

  if (source.storage_uri) {
    return replaceStorageUriPath(source.storage_uri, uriPath);
  }

  const config = source.storage_location?.config as Record<string, unknown> | undefined;
  const bucket = typeof config?.bucket === "string" ? config.bucket : null;
  if (!bucket) {
    return null;
  }

  const storageType = typeof config?.type === "string" ? config.type : null;
  const scheme = storageType === "gcs" ? "gs" : "s3";
  const endpointUrl =
    typeof config?.endpoint_url === "string" ? config.endpoint_url : null;
  const uri = `${scheme}://${bucket}/${uriPath}`;

  return endpointUrl && scheme === "s3"
    ? `${uri}?endpoint_url=${endpointUrl}`
    : uri;
}

export function usesNativeBrowserDownload(urlString: string): boolean {
  try {
    const url = new URL(urlString, window.location.origin);

    if (url.origin === window.location.origin) {
      return !url.pathname.startsWith("/api/") && !url.pathname.includes("/export/");
    }

    return true;
  } catch {
    return false;
  }
}
