import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { analyticsDisabled, PEDP_PRIVACY_URL } from "@/lib/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy & analytics | HIFLD Next" }] }),
  component: Privacy,
});

export function Privacy() {
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
    <article className="mx-auto w-full max-w-3xl space-y-6 px-6 py-12 text-base leading-relaxed">
      <h1 className="text-3xl font-semibold">Privacy &amp; analytics</h1>
      <p>
        HIFLD Next is a Public Environmental Data Partners service. Read the{" "}
        <a className="underline" href={PEDP_PRIVACY_URL}>
          PEDP Privacy Policy
        </a>{" "}
        for details about data collection, analytics providers, search terms, feedback, retention, and your rights.
      </p>
      <h2 className="text-xl font-semibold">Analytics preferences</h2>
      <p>
        Optional analytics help us understand how HIFLD Next is used and which datasets to add. You can turn them off
        here. We also honor Do Not Track and Global Privacy Control.
      </p>
      <p>
        Your choice is saved in a preference cookie for one year. It is not a visitor identifier. Clearing browser
        cookies may reset your choice. You can still submit feedback when analytics are off.
      </p>
      <Button type="button" onClick={toggleAnalytics} disabled={privacySignal} variant="outline">
        {privacySignal ? "Analytics disabled by browser" : disabled ? "Turn on analytics" : "Turn off analytics"}
      </Button>
    </article>
  );
}
