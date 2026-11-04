import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type { DatasetQualityFeedbackInput } from "@/lib/feedback";

const { submitDatasetQualityFeedback } = vi.hoisted(() => ({
  submitDatasetQualityFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/feedback", () => ({
  submitDatasetQualityFeedback: (input: DatasetQualityFeedbackInput) =>
    submitDatasetQualityFeedback(input),
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
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeDisabled();
    expect(screen.queryByText(/in PostHog/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", {name:"privacy notice"})).toHaveAttribute("href", "/privacy");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    expect(submitDatasetQualityFeedback).toHaveBeenCalledWith({
      consent: true,
      consent_version: "2026-11-04",
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

it("keeps the report editable when delivery fails", async () => {
 submitDatasetQualityFeedback.mockRejectedValueOnce(new Error("unavailable"));
 const user = userEvent.setup();
 render(<DataQualityFeedbackDialog context={{collectionSlug:"hifld",datasetSlug:"hospitals",fileSlug:"hospitals"}} />);
 await user.click(screen.getByRole("button",{name:"Report issue"}));
 await user.type(screen.getByLabelText("Email"), "analyst@example.com");
 await user.type(screen.getByLabelText("Comment"), "Missing facility");
 await user.click(screen.getByRole("checkbox"));
 await user.click(screen.getByRole("button",{name:"Submit feedback"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("could not be delivered");
 expect(screen.getByLabelText("Comment")).toHaveValue("Missing facility");
 expect(screen.getByRole("button",{name:"Submit feedback"})).toBeEnabled();
});
