import { describe, expect, it } from "vitest";
import {
  QUERY_MVT_CENTROID_LAT_PROPERTY,
  QUERY_MVT_CENTROID_LNG_PROPERTY,
  QUERY_MVT_FEATURE_HASH_PROPERTY,
  QUERY_MVT_FEATURE_ID_PROPERTY,
  QUERY_MVT_FEATURE_KEY_PROPERTY,
  QUERY_MVT_RESERVED_PROPERTY_NAMES,
  isQueryMvtReservedProperty,
} from "../src/queryMvt";

describe("query MVT reserved properties", () => {
  it("defines every server-generated property that must stay out of public feature fields", () => {
    expect(QUERY_MVT_RESERVED_PROPERTY_NAMES).toEqual([
      QUERY_MVT_FEATURE_ID_PROPERTY,
      QUERY_MVT_FEATURE_HASH_PROPERTY,
      QUERY_MVT_FEATURE_KEY_PROPERTY,
      QUERY_MVT_CENTROID_LNG_PROPERTY,
      QUERY_MVT_CENTROID_LAT_PROPERTY,
    ]);
  });

  it("recognizes reserved properties without hiding similarly named user columns", () => {
    expect(isQueryMvtReservedProperty(QUERY_MVT_FEATURE_KEY_PROPERTY)).toBe(true);
    expect(isQueryMvtReservedProperty(QUERY_MVT_FEATURE_HASH_PROPERTY)).toBe(true);
    expect(isQueryMvtReservedProperty("feature_key")).toBe(false);
  });
});
