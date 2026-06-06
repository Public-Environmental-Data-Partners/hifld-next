import { describe, expect, it } from "vitest";

import { getInitialTablePanelState } from "../TablePanelManager";
import type { LoadedTableSource } from "../multiLayerSources";

const sources: LoadedTableSource[] = [
  {
    id: "left",
    label: "Hospitals v1",
    url: "https://example.test/left.parquet",
    fileName: "left.parquet",
  },
  {
    id: "right",
    label: "Hospitals v2",
    url: "https://example.test/right.parquet",
    fileName: "right.parquet",
  },
];

describe("table panel state", () => {
  it("opens a single table on the active source by default", () => {
    expect(getInitialTablePanelState({ sources })).toEqual({
      primarySourceId: "left",
      secondarySourceId: "right",
      isSplit: false,
    });
  });

  it("opens split table mode when a secondary table is deep-linked", () => {
    expect(
      getInitialTablePanelState({
        sources,
        initialPrimarySourceId: "left",
        initialSecondarySourceId: "right",
      }),
    ).toEqual({
      primarySourceId: "left",
      secondarySourceId: "right",
      isSplit: true,
    });
  });
});
