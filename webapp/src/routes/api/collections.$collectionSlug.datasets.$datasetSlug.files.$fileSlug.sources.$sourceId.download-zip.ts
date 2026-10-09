import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { env } from "@/env/server";
import { catalogAssetUrl, getCollectionBySlug } from "@/lib/api-client";
import { jsonProblem } from "@/lib/api-problem";
import { type CatalogAsset, sqliteCatalogApi } from "@/lib/catalog-api";

const DOWNLOAD_TIMEOUT_MS = 300000;
const legacyCollectionsSchema = z.array(z.object({ id: z.union([z.string(), z.number()]), slug: z.string() }));

export async function legacyZipCollectionId(baseUrl: string, collectionSlug: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/api/collections`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Legacy collection lookup failed: ${response.status}`);
  const collection = legacyCollectionsSchema.parse(await response.json()).find((item) => item.slug === collectionSlug);
  return collection ? String(collection.id) : null;
}

interface DownloadZipParams {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  sourceId: string;
}

export function catalogZipRedirect(assets: CatalogAsset[], sourceId: string): Response {
  const asset = assets.find((candidate) => `${candidate.version}/${candidate.asset_key}` === sourceId);
  if (asset?.media_type !== "application/zip") return jsonProblem(404, "ZIP source not found");
  const location = catalogAssetUrl(asset);
  if (!location) return jsonProblem(404, "ZIP source not found");
  const url = new URL(location);
  if (url.protocol !== "https:" && url.protocol !== "http:") return jsonProblem(502, "Invalid storage URL");
  return new Response(null, { status: 302, headers: { Location: location } });
}

function datasetApiUnavailableDetail(): string {
  return `Check that the service is running at ${env.DATASET_API_URL}`;
}

function isConnectionFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("dns") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  );
}

export async function fetchZipFromDatasetApi(fastApiUrl: string, request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    return await fetch(fastApiUrl, {
      method: "GET",
      headers: {
        Accept: request.headers.get("Accept") || "application/zip",
      },
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function fetchZipErrorResponse(fetchError: Error): Response {
  if (fetchError.name === "AbortError") {
    return jsonProblem(504, "Request timeout", "The download took too long. Please try again.");
  }

  if (isConnectionFailure(fetchError.message)) {
    return jsonProblem(503, "Unable to connect to dataset API", datasetApiUnavailableDetail());
  }

  return jsonProblem(500, "Failed to connect to dataset API", fetchError.message);
}

async function readFailureDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response.text().catch(() => response.statusText);
  }

  const errorJson = (await response.json().catch(() => null)) as { detail?: string } | null;
  if (errorJson?.detail) {
    return String(errorJson.detail);
  }
  return errorJson ? JSON.stringify(errorJson) : response.statusText;
}

export async function forwardZipResponse(response: Response, _params: DownloadZipParams): Promise<Response> {
  if (response.status === 302) {
    const location = response.headers.get("Location");
    if (!location) {
      return jsonProblem(502, "Invalid redirect from dataset API", "The redirect did not include a Location header");
    }
    try {
      const redirectUrl = new URL(location);
      if (redirectUrl.protocol !== "https:" && redirectUrl.protocol !== "http:") {
        return jsonProblem(502, "Invalid redirect from dataset API", "The redirect URL is not HTTP or HTTPS");
      }
    } catch {
      return jsonProblem(502, "Invalid redirect from dataset API", "The redirect URL is malformed");
    }
    return new Response(null, { status: 302, headers: { Location: location } });
  }

  if (!response.ok) {
    return jsonProblem(response.status, "Failed to download zip", await readFailureDetail(response));
  }
  return jsonProblem(502, "Unexpected response from dataset API", "Expected an object-storage redirect");
}

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/sources/$sourceId/download-zip",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const catalog = await sqliteCatalogApi();
          if (catalog && !(env.DATASET_API_URL && /^\d+$/.test(params.sourceId))) {
            const file = await catalog.file(params.collectionSlug, params.datasetSlug, params.fileSlug);
            return file ? catalogZipRedirect(file.assets, params.sourceId) : jsonProblem(404, "File not found");
          }
          if (!env.DATASET_API_URL) {
            return jsonProblem(500, "Server configuration error", "DATASET_API_URL is not configured");
          }

          const collectionId = catalog
            ? await legacyZipCollectionId(env.DATASET_API_URL, params.collectionSlug)
            : (await getCollectionBySlug({ data: { slug: params.collectionSlug } }))?.id;
          if (!collectionId) {
            return jsonProblem(404, "Collection not found");
          }

          const fastApiUrl = `${env.DATASET_API_URL}/api/collections/${collectionId}/datasets/by-slug/${params.datasetSlug}/files/${params.fileSlug}/sources/${params.sourceId}/download-zip`;

          let response: Response;
          try {
            response = await fetchZipFromDatasetApi(fastApiUrl, request);
          } catch (fetchError) {
            return fetchZipErrorResponse(fetchError instanceof Error ? fetchError : new Error(String(fetchError)));
          }

          return forwardZipResponse(response, params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return jsonProblem(500, "Internal server error", msg);
        }
      },
    },
  },
});
