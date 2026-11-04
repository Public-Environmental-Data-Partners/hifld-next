import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CopyButton } from "../CopyButton";
const { trackUrlCopied, trackUiFailure } = vi.hoisted(() => ({trackUrlCopied: vi.fn(), trackUiFailure: vi.fn()}));
vi.mock("@/lib/analytics", () => ({trackUrlCopied}));
vi.mock("@/lib/interaction-analytics", () => ({currentDatasetContext: () => ({dataset_slug: "substations"}), trackUiFailure}));
const writeText = vi.fn();
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true}); });
it("counts successful copies without copied contents", async () => {
  writeText.mockResolvedValue(undefined); render(<CopyButton value="https://secret.test/?token=private" label="Copy URL" />); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(trackUrlCopied).toHaveBeenCalledWith("storage_uri", {datasetSlug: "substations", fileSlug: undefined, format: undefined}));
  expect(writeText).toHaveBeenCalledWith("https://secret.test/?token=private");
});
it("shows a clipboard failure and allows retry", async () => {
  writeText.mockRejectedValueOnce(new Error("secret")).mockResolvedValueOnce(undefined);
  render(<CopyButton value="private SQL" label="Copy config" urlType="duckdb_config" />); fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy"); expect(trackUiFailure).toHaveBeenCalledWith("clipboard", "copy"); expect(trackUrlCopied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button")); await waitFor(() => expect(trackUrlCopied).toHaveBeenCalledWith("duckdb_config", expect.anything())); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
