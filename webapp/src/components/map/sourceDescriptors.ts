import { z } from "zod";
import { compareVersionValues } from "@/components/dataset/versionLabel";
import type { DatasetFile, DatasetFormat, DatasetSource } from "@/lib/api-client";

const sourceDescriptorSchema = z
  .object({
    collectionSlug: z.string().min(1),
    datasetSlug: z.string().min(1),
    fileSlug: z.string().min(1),
    version: z.string().min(1),
    assetKey: z.string().min(1),
    storageLocationSlug: z.string().min(1).optional(),
  })
  .strict();

export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;

export function encodeSourceDescriptor(descriptor: SourceDescriptor): string {
  return encodeURIComponent(JSON.stringify(descriptor));
}

export function decodeSourceDescriptor(value: string | undefined): SourceDescriptor | null {
  if (!value) return null;
  try {
    const parsed = sourceDescriptorSchema.safeParse(JSON.parse(decodeURIComponent(value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeSourceDescriptorList(descriptors: SourceDescriptor[]): string | undefined {
  if (descriptors.length === 0) return undefined;
  return descriptors.map(encodeSourceDescriptor).join("|");
}

export function decodeSourceDescriptorList(value: string | undefined): SourceDescriptor[] {
  if (!value) return [];
  return value
    .split("|")
    .map((entry) => decodeSourceDescriptor(entry))
    .filter((descriptor): descriptor is SourceDescriptor => descriptor !== null);
}

export function sourceDescriptorId(descriptor: SourceDescriptor): string {
  return [
    descriptor.collectionSlug,
    descriptor.datasetSlug,
    descriptor.fileSlug,
    String(descriptor.version),
    descriptor.assetKey,
    descriptor.storageLocationSlug ?? "default",
  ].join(":");
}

function sourceMatchesDescriptor(source: DatasetSource, descriptor: SourceDescriptor): boolean {
  return (
    source.asset_key === descriptor.assetKey &&
    (descriptor.storageLocationSlug === undefined ||
      source.storage_location?.slug === descriptor.storageLocationSlug) &&
    String(source.version ?? "1") === String(descriptor.version)
  );
}

export function findSourceForDescriptor(file: DatasetFile, descriptor: SourceDescriptor): DatasetSource | null {
  const source = (file.formats ?? [])
    .flatMap((entry) => entry.sources)
    .find((entry) => sourceMatchesDescriptor(entry, descriptor));
  return source ?? null;
}

export function findPmtilesSourceForCatalogSource(
  file: DatasetFile,
  requestedSource: DatasetSource,
): DatasetSource | null {
  const pmtiles = file.formats?.find((entry) => entry.format.format_type === "pmtiles");
  if (!pmtiles) return null;

  const requestedLocationSlug = requestedSource.storage_location?.slug;
  const requestedVersion = requestedSource.version;
  return (
    pmtiles.sources.find(
      (source) => source.storage_location?.slug === requestedLocationSlug && source.version === requestedVersion,
    ) ?? null
  );
}

export function firstSourceDescriptorForFormat({
  collectionSlug,
  datasetSlug,
  fileSlug,
  formatEntry,
}: {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  formatEntry: DatasetFormat | undefined;
}): SourceDescriptor | null {
  if (!formatEntry) {
    return null;
  }
  const source = [...(formatEntry?.sources ?? [])].sort((left, right) =>
    compareVersionValues(left.version ?? "1", right.version ?? "1"),
  )[0];
  if (!source?.asset_key) {
    return null;
  }
  return {
    collectionSlug,
    datasetSlug,
    fileSlug,
    version: String(source.version ?? "1"),
    assetKey: source.asset_key,
    ...(source.storage_location?.slug === undefined ? {} : { storageLocationSlug: source.storage_location.slug }),
  };
}

export function descriptorForSource({
  collectionSlug,
  datasetSlug,
  fileSlug,
  source,
}: {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  source: DatasetSource;
}): SourceDescriptor | null {
  if (!source.asset_key) {
    return null;
  }
  return {
    collectionSlug,
    datasetSlug,
    fileSlug,
    version: String(source.version ?? "1"),
    assetKey: source.asset_key,
    ...(source.storage_location?.slug === undefined ? {} : { storageLocationSlug: source.storage_location.slug }),
  };
}
