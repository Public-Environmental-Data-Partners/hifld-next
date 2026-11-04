import { createSerializationAdapter } from "@tanstack/react-router";

/** Scrub route exceptions before SSR hydration, not just their visible presentation. */
export const safeErrorAdapter = createSerializationAdapter({
  key: "hifld-safe-error",
  test: (value): value is Error => value instanceof Error,
  toSerializable: () => "page_unavailable",
  fromSerializable: () => new Error("This page could not load."),
});
