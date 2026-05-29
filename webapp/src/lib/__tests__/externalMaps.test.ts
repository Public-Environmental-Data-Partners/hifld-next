import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl } from "../externalMaps";

describe("external map links", () => {
  it("builds a Google Maps search URL from a centroid", () => {
    expect(googleMapsSearchUrl({ lat: 38.8977, lng: -77.0365 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=38.8977%2C-77.0365",
    );
  });
});
