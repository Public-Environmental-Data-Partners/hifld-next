/** Catalog IDs are qualified paths, never guessed legacy database row IDs. */
export function datasetIdentity(
  collectionId: string,
  datasetId: string,
): { collectionSlug: string; datasetSlug: string } | null {
  const parts = datasetId.split("/");
  if (parts.length !== 2 || parts[0] !== collectionId || !parts[1]) return null;
  return { collectionSlug: collectionId, datasetSlug: parts[1] };
}

export function fileIdentity(
  collectionId: string,
  datasetId: string,
  fileId: string,
): { collectionSlug: string; datasetSlug: string; fileSlug: string } | null {
  const dataset = datasetIdentity(collectionId, datasetId);
  const parts = fileId.split("/");
  if (!dataset || parts.length !== 3 || `${parts[0]}/${parts[1]}` !== datasetId || !parts[2]) return null;
  return { ...dataset, fileSlug: parts[2] };
}
