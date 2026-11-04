import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ParquetViewerPanel } from "../ParquetViewerPanel";
const { trackDataTable, trackUiFailure, byteLengthFromUrl } = vi.hoisted(() => ({trackDataTable: vi.fn(), trackUiFailure: vi.fn(), byteLengthFromUrl: vi.fn()}));
vi.mock("@/lib/analytics", () => ({trackDataTable}));
vi.mock("@/lib/interaction-analytics", () => ({trackUiFailure, currentDatasetContext: () => ({collection_slug: "hifld", dataset_slug: "substations", file_slug: "substations"})}));
vi.mock("hyparquet", () => ({byteLengthFromUrl, parquetMetadataAsync: vi.fn()}));
vi.mock("hyperparam", () => ({asyncBufferFrom: vi.fn(), parquetDataFrame: () => ({numRows: 1, columnDescriptors: []})}));
vi.mock("hightable", () => ({default: ({onError}: {onError: (error: Error) => void}) => <button onClick={() => onError(new Error("private row"))}>Fail table</button>}));
beforeEach(() => {vi.clearAllMocks();});
it("counts table opens and metadata failures without URL or contents", async () => {
  byteLengthFromUrl.mockRejectedValue(new Error("private signed URL"));
  render(<ParquetViewerPanel url="https://private.test?token=secret" fileName="file.parquet" onClose={() => {}} />);
  await waitFor(() => expect(trackUiFailure).toHaveBeenCalledWith("table", "load"));
  expect(trackDataTable).toHaveBeenCalledWith("substations", "substations", "hifld");
  expect(JSON.stringify(trackUiFailure.mock.calls)).not.toMatch(/private|secret/);
});
it("reports lazy table rendering errors", async () => {
  byteLengthFromUrl.mockResolvedValue(123);
  render(<ParquetViewerPanel url="https://public.test/file.parquet" fileName="file.parquet" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", {name: "Fail table"}));
  expect(trackUiFailure).toHaveBeenCalledWith("table", "render");
});
