import type { DatasetFile, DatasetSource } from "@/lib/api-client";
import { sourceDownloadZip } from "@/lib/api-links";

type SourceWithLinks = DatasetSource & {
  links?: { download_zip: string };
};

function isZipArchiveSource(source: DatasetSource): boolean {
  return "path" in source.location && source.location.path.toLowerCase().endsWith(".zip");
}

/** Deep-clone file JSON and add `links.download_zip` on ZIP archive sources. */
export function attachDownloadZipLinksToFile(
  file: DatasetFile,
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
): DatasetFile {
  const f = structuredClone(file) as DatasetFile;
  for (const df of f.formats ?? []) {
    if (df.format.format_type !== "shapefile" && df.format.format_type !== "file_geodatabase") continue;
    for (const s of df.sources ?? []) {
      if (!isZipArchiveSource(s)) continue;
      const src = s as SourceWithLinks;
      src.links = {
        download_zip: sourceDownloadZip(origin, collectionSlug, datasetSlug, fileSlug, s.id),
      };
    }
  }
  return f;
}
