import { afterEach, describe, expect, it, vi } from "vitest";
import { publishedDatasets, publishedStacErrorDetails } from "@/lib/catalog-listing";

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
      errorMessage: "Unexpected token 'o', \"not json\" is not valid JSON",
      contentLength: "8",
      receivedTextLength: 8,
    });
  });

  it("retains a bounded error message for a failed response body", () => {
    expect(publishedStacErrorDetails(new TypeError("Body is unusable"))).toEqual({
      errorName: "TypeError",
      errorMessage: "Body is unusable",
    });
  });

  it("does not share a one-shot upstream body across concurrent listing requests", async () => {
    const sharedResponses = new Map<string, Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);
      const prior = sharedResponses.get(url);
      if (prior) return Promise.resolve(prior);
      const response = new Response(
        JSON.stringify({
          type: "Catalog",
          id: "hifld/example",
          stac_version: "1.1.0",
          description: "Example",
          links: [],
        }),
      );
      sharedResponses.set(url, response);
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetcher);

    const [first, second] = await Promise.all([
      publishedDatasets("https://storage.example/published/_catalog/catalog.sqlite", ["hifld/example/catalog.json"]),
      publishedDatasets("https://storage.example/published/_catalog/catalog.sqlite", ["hifld/example/catalog.json"]),
    ]);

    expect(first).toEqual([
      expect.objectContaining({ id: "hifld/example" }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({ id: "hifld/example" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Set(fetcher.mock.calls.map(([input]) => String(input))).size).toBe(2);
  });
});
