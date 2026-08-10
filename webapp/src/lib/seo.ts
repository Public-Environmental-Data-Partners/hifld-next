import type { DatasetTags } from "@/lib/api-client";

const DEFAULT_DESCRIPTION_LIMIT = 155;

type HtmlEntityName = "amp" | "gt" | "lt" | "nbsp" | "quot";

const HTML_ENTITY_REPLACEMENTS: { [Name in HtmlEntityName]: string } = {
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function isHtmlEntityName(entity: string): entity is HtmlEntityName {
  return entity in HTML_ENTITY_REPLACEMENTS;
}

function decodeHtmlEntity(entity: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
  }

  return isHtmlEntityName(entity) ? HTML_ENTITY_REPLACEMENTS[entity] : `&${entity};`;
}

export function plainTextForSeo(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (_match, entity: string) => decodeHtmlEntity(entity))
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSeoDescription(value: string, maxLength = DEFAULT_DESCRIPTION_LIMIT): string {
  if (value.length <= maxLength) {
    return value;
  }

  const clipped = value.slice(0, maxLength - 1).trimEnd();
  const lastSpace = clipped.lastIndexOf(" ");
  const text = lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped;
  return `${text}...`;
}

export function seoDescription(value: string | null | undefined, maxLength = DEFAULT_DESCRIPTION_LIMIT): string {
  return truncateSeoDescription(plainTextForSeo(value), maxLength);
}

export function pageTitle(name: string, suffix = "HIFLD Next | PEDP"): string {
  const cleanName = plainTextForSeo(name);
  return cleanName ? `${cleanName} | ${suffix}` : suffix;
}

/** Flatten a dataset's tag map into a de-duplicated list of keyword strings. */
export function datasetKeywords(tags: DatasetTags | null | undefined): string[] {
  if (!tags) {
    return [];
  }

  const keywords = new Set<string>();
  for (const value of Object.values(tags)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        keywords.add(item);
      }
    } else {
      keywords.add(value);
    }
  }

  return [...keywords];
}

const DATASET_JSONLD_DESCRIPTION_LIMIT = 5000;

const CATALOG_NAME = "HIFLD Next";

export interface JsonLdParent {
  type: "Collection" | "Dataset";
  name: string;
}

export interface DatasetJsonLdInput {
  name: string;
  description?: string | null | undefined;
  /** Canonical page path or absolute URL for the dataset detail page. */
  url: string;
  /** Path or absolute URL to the machine-readable JSON metadata. */
  metadataUrl?: string | undefined;
  keywords?: string[] | undefined;
  /** Parent entity this dataset/file belongs to (a Collection or a Dataset). */
  isPartOf?: JsonLdParent | undefined;
  dateModified?: string | undefined;
}

export interface DatasetJsonLd {
  "@context": "https://schema.org";
  "@type": "Dataset";
  name: string;
  url: string;
  includedInDataCatalog: { "@type": "DataCatalog"; name: string };
  description?: string;
  keywords?: string[];
  isPartOf?: { "@type": "Collection" | "Dataset"; name: string };
  dateModified?: string;
  distribution?: Array<{ "@type": "DataDownload"; encodingFormat: string; contentUrl: string }>;
}

/**
 * Build a schema.org `Dataset` JSON-LD object for a dataset or file detail page.
 * Emitting this makes the page eligible for Google Dataset Search and dataset
 * rich results, which is a primary discovery channel for a data catalog.
 */
export function buildDatasetJsonLd(input: DatasetJsonLdInput): DatasetJsonLd {
  const description = truncateSeoDescription(plainTextForSeo(input.description), DATASET_JSONLD_DESCRIPTION_LIMIT);
  const keywords = (input.keywords ?? []).map((keyword) => plainTextForSeo(keyword)).filter(Boolean);
  const parentName = input.isPartOf ? plainTextForSeo(input.isPartOf.name) : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: plainTextForSeo(input.name),
    url: input.url,
    includedInDataCatalog: {
      "@type": "DataCatalog",
      name: CATALOG_NAME,
    },
    ...(description ? { description } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(input.isPartOf && parentName ? { isPartOf: { "@type": input.isPartOf.type, name: parentName } } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.metadataUrl
      ? {
          distribution: [
            {
              "@type": "DataDownload",
              encodingFormat: "application/json",
              contentUrl: input.metadataUrl,
            },
          ],
        }
      : {}),
  };
}

export interface DataCatalogJsonLdInput {
  name: string;
  description?: string | null | undefined;
  /** Canonical page path or absolute URL for the collection detail page. */
  url: string;
  dateModified?: string | undefined;
}

export interface DataCatalogJsonLd {
  "@context": "https://schema.org";
  "@type": "DataCatalog";
  name: string;
  url: string;
  isPartOf: { "@type": "DataCatalog"; name: string };
  description?: string;
  dateModified?: string;
}

/**
 * Build a schema.org `DataCatalog` JSON-LD object for a collection detail page.
 * A collection groups many datasets, so it maps to a (sub-)catalog within the
 * top-level HIFLD Next catalog.
 */
export function buildDataCatalogJsonLd(input: DataCatalogJsonLdInput): DataCatalogJsonLd {
  const description = truncateSeoDescription(plainTextForSeo(input.description), DATASET_JSONLD_DESCRIPTION_LIMIT);

  return {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    name: plainTextForSeo(input.name),
    url: input.url,
    isPartOf: {
      "@type": "DataCatalog",
      name: CATALOG_NAME,
    },
    ...(description ? { description } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
}
