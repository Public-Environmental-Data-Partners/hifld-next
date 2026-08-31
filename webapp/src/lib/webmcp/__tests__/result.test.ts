import { boundWebMcpResult, failure, success } from "../result";

describe("WebMCP result envelopes", () => {
  it("returns a success envelope", () => {
    expect(success("Loaded", { id: "roads" })).toEqual({ ok: true, summary: "Loaded", data: { id: "roads" } });
  });

  it("truncates only complete fields and marks the envelope", () => {
    const result = boundWebMcpResult(
      success("Loaded", {
        first: "a".repeat(900),
        second: "b".repeat(900),
        third: "c".repeat(900),
      }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
    expect(result).toMatchObject({ ok: true, truncated: true, data: { first: expect.any(String) } });
  });

  it("omits oversized string fields whole and still considers later fields", () => {
    const result = boundWebMcpResult(
      success("Loaded", {
        oversized: "LONG_SENTINEL_".repeat(200),
        later: "complete value",
      }),
    );
    expect(result).toMatchObject({ ok: true, truncated: true, data: { later: "complete value" } });
    if (result.ok) {
      expect(result.data).not.toHaveProperty("oversized");
      expect(JSON.stringify(result)).not.toContain("LONG_SENTINEL_");
    }
  });

  it("returns stable failures without unexpected exception details", () => {
    expect(failure("internal_error")).toEqual({
      ok: false,
      error: { code: "internal_error", message: "The tool could not complete the request.", retryable: false },
    });
  });
});
