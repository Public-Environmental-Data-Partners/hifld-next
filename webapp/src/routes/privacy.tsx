import { createFileRoute } from "@tanstack/react-router";
import { PEDP_PRIVACY_URL } from "@/lib/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy & analytics | HIFLD Next" }] }),
  component: Privacy,
});

function Privacy() {
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
        page visits, approximate location, device and browser type, referring sites, searches counted without search
        text, map actions, and download activity. We remove query strings and fragments from URLs sent in analytics. We
        do not record session replays, form contents, or automatic clicks.
      </p>
      <p>
        PostHog runs in cookieless mode: it does not store analytics cookies or identifiers in local or session storage.
        It uses the request IP address and browser user agent with a rotating salt on its servers to derive a
        short-lived visitor estimate. This is not a verified person count: shared networks and different devices affect
        estimates, and a returning visitor may be counted again on another day.
      </p>
      <p>
        Use “Turn off analytics” in the footer to object. This saves only your preference in a cookie for one year; it
        is not a visitor identifier. We also honor Do Not Track and Global Privacy Control. Browser privacy settings may
        clear your preference. Consented feedback remains available when analytics are off.
      </p>
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
