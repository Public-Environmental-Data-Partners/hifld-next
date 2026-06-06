import { SURVEY_URL } from "./SurveyButton";

export default function Footer() {
  return (
    <footer className="border-t-2 bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
        <div className="flex flex-col items-start gap-4 text-left sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            A{" "}
            <a
              href="https://screening-tools.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Public Environmental Data Partners
            </a>{" "}
            website
          </p>
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-4">
            <a
              href={SURVEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Share feedback
            </a>
            <span aria-hidden className="hidden sm:inline">
              |
            </span>
            <a
              href="https://donorbox.org/open-environmental-data-project-donations-2?default_interval=o"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Donate
            </a>
            <span aria-hidden className="hidden sm:inline">
              |
            </span>
            <a
              href="https://fultonring.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Made by Fulton Ring
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
