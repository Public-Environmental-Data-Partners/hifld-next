import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchZipFromDatasetApi,
  forwardZipResponse,
} from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.sources.$sourceId.download-zip";

const params = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals",
  fileSlug: "hospitals",
  sourceId: "7",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("download ZIP proxy", () => {
  it("requests the dataset API without following its object-storage redirect", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302 }));

    await fetchZipFromDatasetApi("https://api.example.test/download-zip", new Request("https://web.example.test"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/download-zip",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("forwards a valid object-storage redirect without reading the ZIP body", async () => {
    const result = await forwardZipResponse(
      new Response(null, {
        status: 302,
        headers: { Location: "https://storage.googleapis.com/hifld/hospitals.zip?signature=abc" },
      }),
      params,
    );

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe(
      "https://storage.googleapis.com/hifld/hospitals.zip?signature=abc",
    );
  });

  it("rejects successful archive bodies instead of proxying them", async () => {
    const result = await forwardZipResponse(new Response("zip bytes", { status: 200 }), params);

    expect(result.status).toBe(502);
  });
});
