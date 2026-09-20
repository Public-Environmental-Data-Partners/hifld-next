import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import type { DatasetSource } from "@/lib/api-client";

export function hasUsablePmtilesAsset(source: DatasetSource | null | undefined): boolean {
  if (!source) return false;

  const url = buildSourceFileUrl(source);
  if (!url) return false;
  if (url.includes("*")) return false;

  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pmtiles");
  } catch {
    const baseUrl = url.split(/[?#]/, 1)[0] ?? url;
    return baseUrl.toLowerCase().endsWith(".pmtiles");
  }
}
