import { MessageSquareWarning } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DatasetQualityFeedbackFeature } from "@/lib/analytics";
import { ReporterEmailSchema, submitDatasetQualityFeedback } from "@/lib/feedback";
import { trackUiFailure } from "@/lib/interaction-analytics";
import { FEEDBACK_CONSENT_VERSION } from "@/lib/privacy";

export interface DataQualityFeedbackContext {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  version?: string | number | undefined;
  sourceId?: number | undefined;
  feature?: DatasetQualityFeedbackFeature | undefined;
}

interface DataQualityFeedbackDialogProps {
  context: DataQualityFeedbackContext;
  trigger?: React.ReactNode;
}

interface DataQualityFeedbackDialogState {
  open: boolean;
  email: string;
  emailTouched: boolean;
  comment: string;
  consent: boolean;
  submitting: boolean;
  error: string;
}

function isValidEmailAddress(email: string): boolean {
  return ReporterEmailSchema.safeParse(email).success;
}

export class DataQualityFeedbackDialog extends React.Component<
  DataQualityFeedbackDialogProps,
  DataQualityFeedbackDialogState
> {
  override state: DataQualityFeedbackDialogState = {
    open: false,
    email: "",
    emailTouched: false,
    comment: "",
    consent: false,
    submitting: false,
    error: "",
  };

  private submitFeedback = async () => {
    const { context } = this.props;
    const trimmedEmail = this.state.email.trim();
    const trimmedComment = this.state.comment.trim();
    if (!isValidEmailAddress(trimmedEmail) || !trimmedComment || !this.state.consent || this.state.submitting) {
      this.setState({ emailTouched: true });
      return;
    }
    this.setState({ submitting: true, error: "" });
    try {
      await submitDatasetQualityFeedback({
        consent: true,
        consent_version: FEEDBACK_CONSENT_VERSION,
        reporter_email: trimmedEmail,
        comment: trimmedComment,
        collection_slug: context.collectionSlug,
        dataset_slug: context.datasetSlug,
        file_slug: context.fileSlug,
        version: context.version,
        source_id: context.sourceId,
        feature: context.feature,
      });
      this.setState({
        email: "",
        emailTouched: false,
        comment: "",
        consent: false,
        submitting: false,
        error: "",
        open: false,
      });
    } catch {
      trackUiFailure("feedback", "request");
      this.setState({
        submitting: false,
        error: "Feedback could not be delivered. Please try again. Your report has been kept here.",
      });
    }
  };

  override render() {
    const { trigger } = this.props;
    const trimmedEmail = this.state.email.trim();
    const trimmedComment = this.state.comment.trim();
    const isEmailValid = isValidEmailAddress(trimmedEmail);
    const showEmailError = this.state.emailTouched && trimmedEmail.length > 0 && !isEmailValid;

    return (
      <Dialog
        open={this.state.open}
        onOpenChange={(open) => {
          if (!this.state.submitting) this.setState({ open, consent: false, error: "" });
        }}
      >
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="ghost" size="sm">
              <MessageSquareWarning className="mr-1.5 h-4 w-4" />
              Report issue
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={!this.state.submitting}>
          <DialogHeader>
            <DialogTitle>Report a data issue</DialogTitle>
            <DialogDescription>
              Share what looks wrong. Your note is sent as feedback with the current dataset context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="data-quality-feedback-email">
                Email
              </label>
              <input
                id="data-quality-feedback-email"
                type="email"
                required
                maxLength={254}
                disabled={this.state.submitting}
                aria-invalid={showEmailError}
                aria-describedby={showEmailError ? "data-quality-feedback-email-error" : undefined}
                value={this.state.email}
                onChange={(event) => this.setState({ email: event.target.value })}
                onBlur={() => this.setState({ emailTouched: true })}
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="you@example.com"
              />
              {showEmailError && (
                <p id="data-quality-feedback-email-error" className="text-xs text-destructive">
                  Enter a valid email address.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="data-quality-feedback-comment">
                Comment
              </label>
              <textarea
                id="data-quality-feedback-comment"
                maxLength={5000}
                disabled={this.state.submitting}
                value={this.state.comment}
                onChange={(event) => this.setState({ comment: event.target.value })}
                className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="Describe the issue with this dataset or feature."
              />
            </div>
            <div className="flex items-start gap-2 text-sm">
              <input
                id="feedback-consent"
                type="checkbox"
                checked={this.state.consent}
                disabled={this.state.submitting}
                onChange={(event) => this.setState({ consent: event.target.checked })}
                className="mt-1 size-4 shrink-0"
                aria-describedby="feedback-privacy"
              />
              <label htmlFor="feedback-consent">
                I consent to PEDP storing my email, feedback, and dataset context to investigate and respond to this
                report.
              </label>
            </div>
            <p id="feedback-privacy" className="text-xs text-muted-foreground">
              See the{" "}
              <a className="underline" href="/privacy" target="_blank" rel="noopener noreferrer">
                privacy notice
              </a>
              . This consent applies only to your report.
            </p>
            {this.state.error && (
              <p role="alert" className="text-sm text-destructive">
                {this.state.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={this.state.submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={!isEmailValid || !trimmedComment || !this.state.consent || this.state.submitting}
              onClick={this.submitFeedback}
            >
              {this.state.submitting ? "Sending…" : "Submit feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
