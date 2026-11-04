import { createStart } from "@tanstack/react-start";
import { safeErrorAdapter } from "@/lib/safe-error-serialization";

export const startInstance = createStart(() => ({
  serializationAdapters: [safeErrorAdapter],
}));
