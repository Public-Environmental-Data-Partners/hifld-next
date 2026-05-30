import { describe, expect, it } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import { sourceLifecycleDetails } from "../FileFormatTree";

const createdAt = "2026-05-24T14:30:00Z";
const updatedAt = "2026-05-29T15:45:00Z";

function source({
  sourceMetadata,
  created_at,
  updated_at,
}: {
  sourceMetadata?: DatasetSource["source_metadata"];
  created_at?: string | undefined;
  updated_at?: string | undefined;
}): DatasetSource {
  return {
    id: 19,
    version: "v1.1.0",
    source_type: "file",
    url: "http://localhost:3000/files/hospitals.pmtiles",
    location: {
      version: "v1",
      path: "hospitals-3/hospitals-3/v1.1.0/pmtiles/hospitals.pmtiles",
    },
    created_at,
    updated_at,
    source_metadata: sourceMetadata,
  };
}

describe("FileFormatTree", () => {
  it("formats source catalog date and size for source details", () => {
    const details = sourceLifecycleDetails(
      source({ sourceMetadata: { version: "v1", size_bytes: 1536 }, created_at: createdAt, updated_at: updatedAt }),
    );

    expect(details).toEqual([
      expect.objectContaining({ label: "Cataloged", value: expect.stringContaining("May 24, 2026") }),
      { label: "Size", value: "1.5 KB" },
    ]);
    expect(details.some((detail) => detail.label === "Last metadata update")).toBe(false);
  });

  it("omits misleading source metadata when timestamps and size are missing", () => {
    const details = sourceLifecycleDetails(
      source({
        sourceMetadata: { version: "v1" },
        created_at: undefined,
        updated_at: undefined,
      }),
    );

    expect(details).toEqual([]);
  });
});
