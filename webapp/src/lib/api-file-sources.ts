import type { DatasetFile, DatasetSource } from "@/lib/api-client";
import { sourceDownloadZip } from "@/lib/api-links";

type SourceWithLinks = DatasetSource & {
  links?: { download_zip: string };
};

/** Deep-clone file JSON and add `links.download_zip` on each source. */
export function attachDownloadZipLinksToFile(
  file: DatasetFile,
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string
): DatasetFile {
  const f = structuredClone(file) as DatasetFile;
  for (const df of f.formats ?? []) {
    for (const s of df.sources ?? []) {
      const src = s as SourceWithLinks;
      src.links = {
        download_zip: sourceDownloadZip(
          origin,
          collectionSlug,
          datasetSlug,
          fileSlug,
          s.id
        ),
      };
    }
  }
  return f;
}
