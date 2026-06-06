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
import { type DatasetQualityFeedbackFeature, trackDatasetQualityFeedbackSubmitted } from "@/lib/analytics";

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
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  };

  private submitFeedback = () => {
    const { context } = this.props;
    const trimmedEmail = this.state.email.trim();
    const trimmedComment = this.state.comment.trim();
    if (!isValidEmailAddress(trimmedEmail) || !trimmedComment) {
      this.setState({ emailTouched: true });
      return;
    }
    trackDatasetQualityFeedbackSubmitted({
      reporter_email: trimmedEmail,
      comment: trimmedComment,
      collection_slug: context.collectionSlug,
      dataset_slug: context.datasetSlug,
      file_slug: context.fileSlug,
      version: context.version,
      source_id: context.sourceId,
      feature: context.feature,
    });
    this.setState({ email: "", emailTouched: false, comment: "", open: false });
  };

  override render() {
    const { trigger } = this.props;
    const trimmedEmail = this.state.email.trim();
    const trimmedComment = this.state.comment.trim();
    const isEmailValid = isValidEmailAddress(trimmedEmail);
    const showEmailError = this.state.emailTouched && trimmedEmail.length > 0 && !isEmailValid;

    return (
      <Dialog open={this.state.open} onOpenChange={(open) => this.setState({ open })}>
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="ghost" size="sm">
              <MessageSquareWarning className="mr-1.5 h-4 w-4" />
              Report issue
            </Button>
          )}
        </DialogTrigger>
        <DialogContent>
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
                value={this.state.comment}
                onChange={(event) => this.setState({ comment: event.target.value })}
                className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="Describe the issue with this dataset or feature."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Your email is sent with the report so we can follow up. Feature geometry is not included with this
              feedback.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" disabled={!isEmailValid || !trimmedComment} onClick={this.submitFeedback}>
              Submit feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
