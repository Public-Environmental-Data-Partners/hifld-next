import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type { DatasetQualityFeedbackInput } from "@/lib/analytics";

const { trackDatasetQualityFeedbackSubmitted } = vi.hoisted(() => ({
  trackDatasetQualityFeedbackSubmitted: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackDatasetQualityFeedbackSubmitted: (input: DatasetQualityFeedbackInput) =>
    trackDatasetQualityFeedbackSubmitted(input),
}));

import { DataQualityFeedbackDialog } from "../DataQualityFeedbackDialog";

describe("DataQualityFeedbackDialog", () => {
  it("submits only the comment and supplied dataset context", async () => {
    const user = userEvent.setup();

    render(
      <DataQualityFeedbackDialog
        context={{ collectionSlug: "hifld", datasetSlug: "hospitals-3", fileSlug: "hospitals-3" }}
        trigger={<Button>Report issue</Button>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Report issue" }));
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.tab();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "analyst@example.com");
    await user.type(screen.getByLabelText("Comment"), "This layer is missing a facility.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    expect(trackDatasetQualityFeedbackSubmitted).toHaveBeenCalledWith({
      reporter_email: "analyst@example.com",
      comment: "This layer is missing a facility.",
      collection_slug: "hifld",
      dataset_slug: "hospitals-3",
      file_slug: "hospitals-3",
      version: undefined,
      source_id: undefined,
      feature: undefined,
    });
  });
});
