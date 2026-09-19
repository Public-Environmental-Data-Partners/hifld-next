import { afterEach, describe, expect, it, vi } from "vitest";
import { publishedDatasets } from "@/lib/catalog-listing";

describe("publishedDatasets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the published href when a response cannot be parsed as JSON", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { headers: { "content-length": "8" } }));
    vi.stubGlobal("fetch", fetcher);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await publishedDatasets(
      "https://storage.example/published/_catalog/catalog.sqlite",
      ["hifld/example/catalog.json"],
    );

    expect(result).toBeInstanceOf(Response);
    expect(report).toHaveBeenCalledWith("Published STAC metadata failure", {
      href: "hifld/example/catalog.json",
      kind: "json",
      errorName: "SyntaxError",
      contentLength: "8",
      receivedTextLength: 8,
    });
  });
});
