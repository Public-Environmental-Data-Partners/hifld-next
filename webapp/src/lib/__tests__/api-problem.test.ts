import { describe, expect, it } from "vitest";
import { jsonProblem } from "../api-problem";

describe("jsonProblem", () => {
  it("serializes optional instance and links", async () => {
    const res = jsonProblem(404, "Not Found", "no such route", {
      instance: "/api/collections/foo/items",
      links: {
        api_index: "https://example.com/api",
        openapi: "https://example.com/api/openapi",
      },
    });
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
    expect(body.detail).toBe("no such route");
    expect(body.instance).toBe("/api/collections/foo/items");
    expect(body.links).toEqual({
      api_index: "https://example.com/api",
      openapi: "https://example.com/api/openapi",
    });
  });
});
