import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_DATASET_API_URL: z.string(),
    PUBLIC_POSTHOG_KEY: z.string().optional(),
    PUBLIC_POSTHOG_HOST: z.string(),
  },
  runtimeEnv: {
    PUBLIC_DATASET_API_URL: import.meta.env["VITE_PUBLIC_DATASET_API_URL"],
    PUBLIC_POSTHOG_KEY: import.meta.env["VITE_PUBLIC_POSTHOG_KEY"],
    PUBLIC_POSTHOG_HOST: import.meta.env["VITE_PUBLIC_POSTHOG_HOST"],
  } as const,
  skipValidation: false,
  emptyStringAsUndefined: true,
});
