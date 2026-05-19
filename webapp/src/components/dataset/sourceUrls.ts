import type { DatasetSource, FileLocation } from "@/lib/api-client";

function isFileLocation(location: DatasetSource["location"]): location is FileLocation {
  return "path" in location;
}

function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function buildSourceFileUrl(source: DatasetSource): string | null {
  if (source.source_type === "api" && "url" in source.location) {
    return source.location.url;
  }

  if (source.source_type !== "file" || !isFileLocation(source.location)) {
    return source.url ?? null;
  }

  const path = source.location.path;
  const baseUrl = source.storage_location?.config?.base_url;

  if (!path || path.includes("*")) {
    return null;
  }

  if (baseUrl) {
    return joinUrlPath(baseUrl, path);
  }

  return source.url ?? null;
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
