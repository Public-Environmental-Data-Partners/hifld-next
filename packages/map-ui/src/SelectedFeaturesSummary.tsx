import { X } from "lucide-react";
import { type ReactNode, useId } from "react";

export interface SelectedFeaturesSummaryProps {
  countLabel: string;
  onClear: () => void;
  capMessage?: ReactNode;
  contextNote?: string | undefined;
  className?: string | undefined;
  summaryClassName?: string | undefined;
  clearButtonClassName?: string | undefined;
}

export function SelectedFeaturesSummary({
  countLabel,
  onClear,
  capMessage,
  contextNote,
  className,
  summaryClassName,
  clearButtonClassName,
}: SelectedFeaturesSummaryProps): ReactNode {
  const tooltipId = useId();

  return (
    <div className={className ?? "selected-features-header"}>
      <div className={summaryClassName ?? "selected-features-summary"} data-testid="selected-features-summary">
        <strong className="selected-features-count">{countLabel}</strong>
        {contextNote ? (
          <button
            type="button"
            className="selection-context-note"
            data-slot="selection-context-note"
            aria-label={contextNote}
            aria-describedby={tooltipId}
          >
            <span className="selection-context-mark" aria-hidden="true">*</span>
            <span className="selection-context-tooltip" id={tooltipId} role="tooltip">
              {contextNote}
            </span>
          </button>
        ) : null}
        {capMessage ? <span data-slot="selection-cap-message">{capMessage}</span> : null}
      </div>
      <button
        type="button"
        className={clearButtonClassName ?? "selected-features-clear"}
        aria-label="Clear selected features"
        onClick={onClear}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
