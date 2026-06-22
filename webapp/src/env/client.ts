import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_DATASET_API_URL: z.string(),
  },
  runtimeEnv: {
    PUBLIC_DATASET_API_URL: import.meta.env["VITE_PUBLIC_DATASET_API_URL"],
  } as const,
  skipValidation: false,
  emptyStringAsUndefined: true,
});
