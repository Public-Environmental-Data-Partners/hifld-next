import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // No server environment variables needed - all backend logic moved to dataset-api
  },
  runtimeEnv: process.env,
});
