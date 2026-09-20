import { z } from "zod";
import type { CatalogStacVersion } from "@/lib/catalog-repository";
import { fetchCatalogStac, stacDocumentSchema } from "@/lib/catalog-stac";

export const STAC_API_CONFORMANCE = [
  "https://api.stacspec.org/v1.0.0/core",
  "https://api.stacspec.org/v1.0.0/collections",
] as const;

const PAGE_SIZE = 50;
const stacLinkSchema = z.object({ rel: z.string(), href: z.string(), type: z.string().optional() }).catchall(z.json());
const stacApiDocumentSchema = stacDocumentSchema.extend({ links: z.array(stacLinkSchema) });
const cursorSchema = z.object({ generation: z.string().min(1), after: z.string().min(1) }).strict();

type StacDocument = z.infer<typeof stacApiDocumentSchema>;
type StacLink = z.infer<typeof stacLinkSchema>;

export class InvalidStacCursorError extends Error {}
export class StaleStacCursorError extends Error {}

function apiLink(rel: string, href: string): StacLink {
  return { rel, href, type: "application/json" };
}

export function stacCollectionUrl(origin: string, id: string): string {
  return `${origin}/stac/collections/${encodeURIComponent(id)}`;
}

export function buildStacLanding(publishedRoot: StacDocument, origin: string) {
  if (publishedRoot.type !== "Catalog") throw new Error("Published STAC root must be a Catalog");
  const replaced = new Set(["self", "root", "data", "service-desc", "service-doc", "search", "child"]);
  return {
    ...publishedRoot,
    conformsTo: [...STAC_API_CONFORMANCE],
    links: [
      apiLink("self", `${origin}/stac`),
      apiLink("root", `${origin}/stac`),
      apiLink("data", `${origin}/stac/collections`),
      {
        rel: "service-desc",
        href: `${origin}/stac/api`,
        type: "application/vnd.oai.openapi+json;version=3.1",
      },
      ...publishedRoot.links.filter((link) => !replaced.has(link.rel)),
    ],
  };
}

export function buildStacCollection(published: StacDocument, origin: string) {
  if (published.type !== "Collection") throw new Error("Published STAC document must be a Collection");
  const replaced = new Set(["self", "root", "parent", "items"]);
  return {
    ...published,
    links: [
      apiLink("self", stacCollectionUrl(origin, published.id)),
      apiLink("root", `${origin}/stac`),
      apiLink("parent", `${origin}/stac`),
      ...published.links.filter((link) => !replaced.has(link.rel)),
    ],
  };
}

export function encodeStacCursor(cursor: { generation: string; after: string }): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor)), "utf8").toString("base64url");
}

export function decodeStacCursor(token: string | null, generation: string): string | null {
  if (token === null) return null;
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(token)) throw new InvalidStacCursorError("Invalid STAC cursor");
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
  } catch {
    throw new InvalidStacCursorError("Invalid STAC cursor");
  }
  if (cursor.generation !== generation) throw new StaleStacCursorError("STAC cursor is stale");
  return cursor.after;
}

export async function loadStacDocument(catalogUrl: string, href: string): Promise<StacDocument> {
  const response = await fetchCatalogStac(catalogUrl, href);
  if (!response.ok) throw new Error(`Published STAC document returned ${response.status}`);
  return stacApiDocumentSchema.parse(await response.json());
}

function listingUrl(origin: string, generation: string, after: string | null): string {
  const url = new URL(`${origin}/stac/collections`);
  if (after !== null) url.searchParams.set("cursor", encodeStacCursor({ generation, after }));
  return url.href;
}

export async function buildStacCollectionsPage(query: {
  entries: CatalogStacVersion[];
  catalogUrl: string;
  origin: string;
  generation: string;
  after: string | null;
}) {
  const selected = query.entries.slice(0, PAGE_SIZE);
  const collections: Array<ReturnType<typeof buildStacCollection>> = [];
  for (let offset = 0; offset < selected.length; offset += 8) {
    const batch = await Promise.all(
      selected.slice(offset, offset + 8).map(async (entry) => {
        const document = await loadStacDocument(query.catalogUrl, entry.collection_href);
        if (document.type !== "Collection" || document.id !== entry.version_path) {
          throw new Error(`Published STAC Collection does not match ${entry.version_path}`);
        }
        return buildStacCollection(document, query.origin);
      }),
    );
    collections.push(...batch);
  }
  const links = [
    apiLink("self", listingUrl(query.origin, query.generation, query.after)),
    apiLink("root", `${query.origin}/stac`),
  ];
  const last = selected.at(-1);
  if (query.entries.length > PAGE_SIZE && last) {
    links.push(apiLink("next", listingUrl(query.origin, query.generation, last.version_path)));
  }
  return { collections, links };
}
