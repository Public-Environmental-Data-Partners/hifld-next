import { afterEach, beforeEach, expect, it, vi } from "vitest";
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ getPostHog: () => ({ capture }) }));
afterEach(() => { document.cookie = "hifld_analytics=; Max-Age=0; Path=/"; });
beforeEach(() => {
  vi.resetModules(); capture.mockClear();
  window.history.replaceState({}, "", "/collections/hifld/datasets/substations/files/substations?query=secret#private");
});
it("allowlists fields, deduplicates failures, and resets on navigation", async () => {
  const { trackUiFailure } = await import("../interaction-analytics");
  const context = { dataset_slug: "substations", message: "email@example.org", sql: "secret", url: "https://secret.test" };
  trackUiFailure("map", "load", context); trackUiFailure("map", "load", context);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith("ui_operation_failed", {
    feature: "map", failure: "load", route_kind: "dataset", collection_slug: "hifld", dataset_slug: "substations", file_slug: "substations",
  });
  window.history.replaceState({}, "", "/collections/hifld/map"); trackUiFailure("map", "load");
  expect(capture).toHaveBeenCalledTimes(2);
});
it("bounds error storms and honors opt-out", async () => {
  const { trackUiFailure } = await import("../interaction-analytics");
  document.cookie = "hifld_analytics=off; Path=/"; trackUiFailure("map", "load");
  expect(capture).not.toHaveBeenCalled(); document.cookie = "hifld_analytics=; Max-Age=0; Path=/";
  for (let n = 0; n < 30; n++) trackUiFailure("map", "load", {dataset_slug: `dataset-${n}`});
  expect(capture).toHaveBeenCalledTimes(20);
});
it("reports browser failures without messages/reasons and cleans up listeners", async () => {
  const { installFailureTracking } = await import("../interaction-analytics");
  const cleanup = installFailureTracking();
  window.dispatchEvent(new ErrorEvent("error", { message: "secret email@example.org", error: new Error("private") }));
  const rejection = new Event("unhandledrejection"); Object.defineProperty(rejection, "reason", {value: new Error("private SQL")}); window.dispatchEvent(rejection);
  expect(capture.mock.calls.map(call => call[1].failure)).toEqual(["runtime", "unhandled_rejection"]);
  expect(JSON.stringify(capture.mock.calls)).not.toMatch(/secret|email@|private|SQL/);
  cleanup(); capture.mockClear(); window.dispatchEvent(new ErrorEvent("error")); expect(capture).not.toHaveBeenCalled();
});
it("ignores canceled requests", async () => {
  const { installFailureTracking } = await import("../interaction-analytics"); const cleanup = installFailureTracking();
  const event = new Event("unhandledrejection"); Object.defineProperty(event, "reason", {value: new DOMException("canceled", "AbortError")});
  window.dispatchEvent(event); expect(capture).not.toHaveBeenCalled(); cleanup();
});
