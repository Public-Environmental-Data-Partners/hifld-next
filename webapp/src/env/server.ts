import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Dataset API URL for server-side routes (loader functions)
    DATASET_API_URL: z.string().url(),
  },
  runtimeEnv: {
    ...process.env,
    // Local dev convenience: allow using only VITE_PUBLIC_DATASET_API_URL in .env
    DATASET_API_URL: process.env["DATASET_API_URL"] || process.env["VITE_PUBLIC_DATASET_API_URL"],
  },
});
