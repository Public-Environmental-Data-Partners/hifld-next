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
        for our privacy commitments and contact information.
      </p>
      <h2 className="text-xl font-semibold">Understanding use without tracking you across visits</h2>
      <p>
        We use PostHog to estimate visitors and understand which datasets and features are useful. Analytics include
        page visits, approximate location, device and browser type, referring sites, dataset search terms and result
        counts, map actions, and download activity. We remove query strings and fragments from URLs sent in analytics.
        We do not record session replays, automatic form captures, or automatic clicks.
      </p>
      <p>
        We record dataset search terms, including searches with no results, to identify datasets we should add. Terms
        are normalized for case and spacing and limited to 200 characters. We omit text matching common email, URL,
        phone number, precise coordinate, or street-address patterns. This filtering is imperfect: personal names and
        other sensitive information may still pass, and legitimate queries may be omitted. Please do not enter personal
        or confidential information in dataset searches. Searches still work when their text is omitted from analytics,
        and their result counts are still recorded.
      </p>
      <p>
        PostHog runs in cookieless mode: it does not store analytics cookies or identifiers in local or session storage.
        It uses the request IP address and browser user agent with a rotating salt on its servers to derive a
        short-lived visitor estimate. This is not a verified person count: shared networks and different devices affect
        estimates, and a returning visitor may be counted again on another day.
      </p>
      <p>
        Use “Turn off analytics” below to object. This saves only your preference in a cookie for one year; it is not a
        visitor identifier. We also honor Do Not Track and Global Privacy Control. Browser privacy settings may clear
        your preference. Consented feedback remains available when analytics are off.
      </p>
      <Button type="button" onClick={toggleAnalytics} disabled={privacySignal} variant="outline">
        {privacySignal ? "Analytics disabled by browser" : disabled ? "Turn on analytics" : "Turn off analytics"}
      </Button>
      <h2 className="text-xl font-semibold">Downloads and agent access</h2>
      <p>
        We measure download clicks, browser handoffs, and confirmed completions separately. A handoff is not proof a
        file finished downloading. Byte totals are measured only when this application handles the transfer; they do not
        cover all direct or external downloads.
      </p>
      <p>
        Server analytics count API and discovery requests by route, response status, and client category. Agent provider
        and purpose labels are derived from self-declared user agents, which are then discarded from these events. They
        do not verify an operator or identify individual agents.
      </p>
      <h2 className="text-xl font-semibold">Reports you choose to send</h2>
      <p>
        The data issue form requires an unchecked consent box before submission. With your consent, we store your email,
        comment, dataset context, and any selected feature context in PostHog so we can investigate and respond. Feature
        geometry is excluded. We record the consent time and notice version separately from visitor analytics, without
        linking the report to your browsing identity.
      </p>
      <p>
        Information is kept for no longer than two years under PEDP’s policy. Contact{" "}
        <a className="underline" href="mailto:hello@publicenvirodata.org">
          hello@publicenvirodata.org
        </a>{" "}
        to request deletion or withdraw feedback consent. Do not include confidential information in a report.
      </p>
      <p>External survey, donation, and linked services have their own data collection practices.</p>
    </article>
  );
}
