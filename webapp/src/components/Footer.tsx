import { useEffect, useState } from "react";
import { PEDP_DONATE_URL } from "@/lib/pedp";
import { analyticsDisabled } from "@/lib/privacy";
import { SURVEY_URL } from "./SurveyButton";

export default function Footer() {
  const [disabled, setDisabled] = useState(false);
  const [privacySignal, setPrivacySignal] = useState(false);
  useEffect(() => {
    setDisabled(analyticsDisabled());
    setPrivacySignal(navigator.doNotTrack === "1" || Reflect.get(navigator, "globalPrivacyControl") === true);
  }, []);
  function toggleAnalytics() {
    const next = !disabled;
    // biome-ignore lint/suspicious/noDocumentCookie: This preference must be readable by the server and supported across browsers.
    document.cookie = `hifld_analytics=${next ? "off" : ""}; Path=/; SameSite=Lax; Max-Age=${next ? 31536000 : 0}${window.location.protocol === "https:" ? "; Secure" : ""}`;
    setDisabled(next || navigator.doNotTrack === "1" || Reflect.get(navigator, "globalPrivacyControl") === true);
  }
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
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <a href="/privacy" className="hover:text-foreground transition-colors">
              Privacy &amp; analytics
            </a>
            <button
              type="button"
              onClick={toggleAnalytics}
              className="hover:text-foreground transition-colors underline"
              disabled={privacySignal}
            >
              {privacySignal ? "Analytics disabled by browser" : disabled ? "Turn on analytics" : "Turn off analytics"}
            </button>
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
              href={PEDP_DONATE_URL}
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
