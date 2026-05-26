import { z } from "zod";
import { compareVersionValues } from "@/components/dataset/versionLabel";
import type { DatasetFile, DatasetFormat, DatasetSource, FormatType } from "@/lib/api-client";

const sourceDescriptorSchema = z.object({
  collectionSlug: z.string().min(1),
  datasetSlug: z.string().min(1),
  fileSlug: z.string().min(1),
  formatType: z.custom<FormatType>((value) => typeof value === "string" && value.length > 0),
  storageLocationId: z.number().int().positive(),
  version: z.union([z.string().min(1), z.number()]),
  sourceId: z.number().int().positive().optional(),
});

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
    descriptor.formatType,
    descriptor.storageLocationId,
    String(descriptor.version),
    descriptor.sourceId ?? "source",
  ].join(":");
}

function sourceMatchesDescriptor(source: DatasetSource, descriptor: SourceDescriptor): boolean {
  if (descriptor.sourceId !== undefined && source.id === descriptor.sourceId) {
    return true;
  }
  return (
    source.storage_location?.id === descriptor.storageLocationId &&
    String(source.version ?? "1") === String(descriptor.version)
  );
}

export function findSourceForDescriptor(file: DatasetFile, descriptor: SourceDescriptor): DatasetSource | null {
  const formatEntry = file.formats?.find((entry) => entry.format.format_type === descriptor.formatType);
  const source = formatEntry?.sources.find((entry) => sourceMatchesDescriptor(entry, descriptor));
  return source ?? null;
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
  const storageLocationId = source?.storage_location?.id;
  if (!source || storageLocationId === undefined) {
    return null;
  }
  return {
    collectionSlug,
    datasetSlug,
    fileSlug,
    formatType: formatEntry.format.format_type,
    storageLocationId,
    version: source.version ?? "1",
    sourceId: source.id,
  };
}

export function descriptorForSource({
  collectionSlug,
  datasetSlug,
  fileSlug,
  formatType,
  source,
}: {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  formatType: FormatType;
  source: DatasetSource;
}): SourceDescriptor | null {
  const storageLocationId = source.storage_location?.id;
  if (storageLocationId === undefined) {
    return null;
  }
  return {
    collectionSlug,
    datasetSlug,
    fileSlug,
    formatType,
    storageLocationId,
    version: source.version ?? "1",
    sourceId: source.id,
  };
}
