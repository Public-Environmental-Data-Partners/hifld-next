import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Dataset API URL for server-side routes (loader functions)
    DATASET_API_URL: z.string().url(),
    // Private dataset-mcp URL used only by the same-origin query proxy.
    DATASET_MCP_QUERY_API_URL: z
      .string()
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "DATASET_MCP_QUERY_API_URL must use HTTP or HTTPS")
      .optional(),
  },
  runtimeEnv: {
    DATASET_API_URL: process.env["DATASET_API_URL"],
    DATASET_MCP_QUERY_API_URL: process.env["DATASET_MCP_QUERY_API_URL"],
  },
});
