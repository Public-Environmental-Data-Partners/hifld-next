import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Configure one published SQLite catalog source for server-side reads.
    CATALOG_SQLITE_PATH: z.string().min(1).optional(),
    CATALOG_SQLITE_URL: z.string().url().optional(),
    CATALOG_RELEASE_POINTER_URL: z.string().url().optional(),
    CATALOG_STORAGE_LOCATIONS_JSON: z.string().optional(),
    // Private dataset-mcp URL used only by the same-origin query proxy.
    DATASET_MCP_QUERY_API_URL: z
      .string()
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "DATASET_MCP_QUERY_API_URL must use HTTP or HTTPS")
      .optional(),
    WEBAPP_PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    CATALOG_SQLITE_PATH: process.env["CATALOG_SQLITE_PATH"],
    CATALOG_SQLITE_URL: process.env["CATALOG_SQLITE_URL"],
    CATALOG_RELEASE_POINTER_URL: process.env["CATALOG_RELEASE_POINTER_URL"],
    CATALOG_STORAGE_LOCATIONS_JSON: process.env["CATALOG_STORAGE_LOCATIONS_JSON"],
    DATASET_MCP_QUERY_API_URL: process.env["DATASET_MCP_QUERY_API_URL"],
    WEBAPP_PUBLIC_ORIGIN: process.env["WEBAPP_PUBLIC_ORIGIN"],
  },
});
