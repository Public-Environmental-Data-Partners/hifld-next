import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommonsMemberBanner } from "@/components/CommonsMemberBanner";
import { SURVEY_URL } from "@/components/SurveyButton";

export const Route = createFileRoute("/commons/")({
  component: CommonsPage,
});

function CommonsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-1">
        <Link to="/">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to home
        </Link>
      </Button>

      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        HIFLD Next Commons
      </h1>

      <div className="mt-6 text-muted-foreground">
        <p className="text-lg leading-relaxed">
          Alongside the platform launch, we are forming the{" "}
          <strong className="text-foreground">HIFLD Next Commons</strong>, a
          coalition of mission-driven organizations committed to stewarding and
          expanding the catalog over time.
        </p>
      </div>

      <section className="mt-10">
        <h2 className="text-center text-lg font-semibold tracking-tight text-foreground">
          Stewards
        </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-10 sm:gap-14">
          <CommonsMemberBanner size="page" />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          How to join
        </h2>
        <p className="mt-3 text-muted-foreground">
          If your organization is interested in joining the HIFLD Next Commons as
          a steward or partner, we'd like to hear from you. We are looking for
          mission-aligned organizations that can help steward the catalog,
          contribute data or tools, or support governance and outreach.
        </p>
        <p className="mt-3 text-muted-foreground">
          <a
            href={SURVEY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Share your interest or feedback in our survey
          </a>
          .
        </p>
      </section>
    </div>
  );
}
