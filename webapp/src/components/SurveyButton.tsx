import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getPostHog } from "@/lib/analytics";

export const SURVEY_URL = "https://sugary-patio-2bd.notion.site/f7192090b55a41748a182e2e6c1a6114";

export function SurveyButton() {
  const [isOpen, setIsOpen] = useState(false);

  const handleSurveyClick = () => {
    // Track survey button click
    const posthog = getPostHog();
    if (posthog) {
      try {
        posthog.capture("survey_button_clicked", {
          survey_url: SURVEY_URL,
        });
      } catch (error) {
        console.error("Failed to track survey click:", error);
      }
    }
    setIsOpen(false);
  };

  const handlePopoverOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Track when popover is opened
      const posthog = getPostHog();
      if (posthog) {
        try {
          posthog.capture("survey_popover_opened");
        } catch (error) {
          console.error("Failed to track survey popover open:", error);
        }
      }
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <Popover open={isOpen} onOpenChange={handlePopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow bg-primary hover:bg-primary/90"
            aria-label="Take survey"
          >
            <ClipboardList className="h-6 w-6" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="left" align="end" className="w-80">
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-sm">Help us improve</h4>
              <p className="text-sm text-muted-foreground mt-1">Share your feedback about HIFLD Next</p>
            </div>
            <Button asChild className="w-full" onClick={handleSurveyClick}>
              <a href={SURVEY_URL} target="_blank" rel="noopener noreferrer">
                Take Survey
              </a>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
