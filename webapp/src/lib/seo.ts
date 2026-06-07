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
