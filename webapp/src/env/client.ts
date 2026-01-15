import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Dev environment config (for local development)
const devConfig = {
  PUBLIC_DATASET_API_URL: "http://localhost:8000",
};

// Prod environment config (for production builds)
// Use environment variable if set, otherwise fallback to hardcoded URL
const prodConfig = {
  PUBLIC_DATASET_API_URL:
    process.env.PUBLIC_DATASET_API_URL ||
    "https://hifld-dataset-api-prod-ufb5vmntfq-uc.a.run.app",
};

// Use prod config if NODE_ENV is production, otherwise use dev
// NODE_ENV is set in Dockerfile at build time
const isProduction = process.env.NODE_ENV === "production";

export const env = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_DATASET_API_URL: z.string().url(),
  },
  runtimeEnv: isProduction ? prodConfig : devConfig,
  skipValidation: false,
  emptyStringAsUndefined: true,
});
