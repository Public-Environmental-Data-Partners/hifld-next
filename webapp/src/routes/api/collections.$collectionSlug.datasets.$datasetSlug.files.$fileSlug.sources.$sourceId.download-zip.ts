import { createFileRoute } from "@tanstack/react-router";
import { getCollectionBySlug } from "@/lib/api-client";
import { env } from "@/env/server";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/sources/$sourceId/download-zip"
)({
  server: {
    handlers: {
      // GET /api/collections/:collectionSlug/datasets/:datasetSlug/files/:fileSlug/sources/:sourceId/download-zip
      // Proxies to FastAPI endpoint to download shapefile as zip
      GET: async ({ params, request }) => {
        try {
          console.log("Download zip request:", params);
          
          // Validate DATASET_API_URL is set
          if (!env.DATASET_API_URL) {
            console.error("DATASET_API_URL environment variable is not set");
            return new Response(
              "Server configuration error: DATASET_API_URL is not configured",
              { 
                status: 500,
                headers: { "Content-Type": "text/plain" }
              }
            );
          }
          
          // Get collection to get the ID
          const collection = await getCollectionBySlug({
            data: { slug: params.collectionSlug },
          });
          if (!collection) {
            console.error("Collection not found:", params.collectionSlug);
            return new Response(
              `Collection not found: ${params.collectionSlug}`,
              { 
                status: 404,
                headers: { "Content-Type": "text/plain" }
              }
            );
          }

          // Construct the FastAPI endpoint URL
          const fastApiUrl = `${env.DATASET_API_URL}/api/collections/${collection.id}/datasets/by-slug/${params.datasetSlug}/files/${params.fileSlug}/sources/${params.sourceId}/download-zip`;
          console.log("Fetching from FastAPI:", fastApiUrl);

          // Fetch from FastAPI with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for large files
          
          let response: Response;
          try {
            response = await fetch(fastApiUrl, {
              method: "GET",
              headers: {
                Accept: request.headers.get("Accept") || "application/zip",
              },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
          } catch (fetchError) {
            clearTimeout(timeoutId);
            
            // Handle network errors
            if (fetchError instanceof Error) {
              if (fetchError.name === "AbortError") {
                console.error("Request timeout when fetching from FastAPI:", fastApiUrl);
                return new Response(
                  "Request timeout: The download took too long. Please try again.",
                  { 
                    status: 504,
                    headers: { "Content-Type": "text/plain" }
                  }
                );
              }
              
              // Check for common network errors
              const errorMessage = fetchError.message.toLowerCase();
              if (errorMessage.includes("fetch failed") || 
                  errorMessage.includes("network") ||
                  errorMessage.includes("dns") ||
                  errorMessage.includes("econnrefused") ||
                  errorMessage.includes("enotfound")) {
                console.error("Network error when fetching from FastAPI:", fastApiUrl, fetchError.message);
                return new Response(
                  `Unable to connect to dataset API. Please check that the service is running and accessible at ${env.DATASET_API_URL}`,
                  { 
                    status: 503,
                    headers: { "Content-Type": "text/plain" }
                  }
                );
              }
            }
            
            console.error("Unexpected error when fetching from FastAPI:", fastApiUrl, fetchError);
            return new Response(
              `Failed to connect to dataset API: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
              { 
                status: 500,
                headers: { "Content-Type": "text/plain" }
              }
            );
          }

          if (!response.ok) {
            let errorText = response.statusText;
            let errorDetail = "";
            try {
              const contentType = response.headers.get("content-type") || "";
              if (contentType.includes("application/json")) {
                const errorJson = await response.json().catch(() => null);
                if (errorJson && errorJson.detail) {
                  errorDetail = errorJson.detail;
                } else if (errorJson) {
                  errorDetail = JSON.stringify(errorJson);
                }
              } else {
                errorText = await response.text().catch(() => response.statusText);
                errorDetail = errorText;
              }
            } catch (e) {
              console.error("Error reading error response:", e);
            }
            
            const fullError = errorDetail || errorText;
            console.error("FastAPI error:", {
              status: response.status,
              statusText: response.statusText,
              error: fullError,
              url: fastApiUrl
            });
            
            return new Response(
              `Failed to download zip (${response.status}): ${fullError}`,
              { 
                status: response.status,
                headers: { "Content-Type": "text/plain" }
              }
            );
          }

          // Stream the zip through to the client instead of buffering. Cloud Run has a 32MB
          // limit for non-streaming responses; streaming uses chunked encoding and avoids that.
          if (!response.body) {
            return new Response("Empty response from dataset API", {
              status: 502,
              headers: { "Content-Type": "text/plain" },
            });
          }
          const contentDisposition =
            response.headers.get("Content-Disposition") ||
            `attachment; filename="${params.datasetSlug}_${params.fileSlug}_shapefile.zip"`;
          const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
          const filename = filenameMatch
            ? filenameMatch[1]
            : `${params.datasetSlug}_${params.fileSlug}_shapefile.zip`;
          console.log("Streaming zip to client, filename:", filename);

          return new Response(response.body, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (error) {
          console.error("Error proxying zip download:", error);
          return new Response(
            `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
            { 
              status: 500,
              headers: { "Content-Type": "text/plain" }
            }
          );
        }
      },
    },
  },
});
