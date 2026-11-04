# Central PEDP privacy policy: HIFLD Next publication update

Status: prepared for the PEDP site editor; not published. Do not deploy the simplified HIFLD notice until this update is published and verified at https://www.publicenvirodata.org/privacy-policy.

## Editor instructions

The website uses Sanity's `sitePage` document for `privacy-policy`. Its policy text is the `body` of the `legalDocumentSection`; `lastUpdated` is a separate date field. Edit this existing document rather than creating a second policy or replacing unrelated PEDP provisions.

1. Explicitly include `hifld.publicenvirodata.org` in the existing scope paragraph.
2. Insert the public-facing section below after the existing paragraph about automatically collected usage information.
3. Retain the existing PEDP provisions on safeguards, no sale/rental, public attribution, retention, and contact details. Confirm the operational two-year maximum applies to PostHog events, feedback, exports, backups, and retained logs before publication. Do not treat this text as evidence retention is already enforced.
4. Set `lastUpdated` to the actual publication date and publish the existing policy document. Check the live page contains all of the HIFLD section, including the provider name, search terms, feedback, and preferences link.
5. Only then merge/deploy the HIFLD simplification in PR #105. Until publication, keep the existing HIFLD disclosures visible. The local preview deliberately remains on its previous build while this dependency is unresolved.

The account connected to this session has read-only GitHub access to `Public-Environmental-Data-Partners/website`; no authenticated Sanity editor connection is available. This document is publication-ready copy, not a record of a CMS mutation.

## Public-facing insertion

### HIFLD Next: usage analytics and feedback

HIFLD Next, at hifld.publicenvirodata.org, is covered by this policy. The following information describes its analytics and feedback features specifically. Other PEDP websites and tools may use different services and features.

**What we collect and why.** We use PostHog to understand how HIFLD Next is used, improve the service, and identify datasets people need. Usage information may include pages visited, approximate location where available, browser and device type, referring sites, dataset search terms and result counts, map and tool actions, and download activity. We remove query strings and fragments from URLs sent in analytics. We do not record session replays or automatically capture clicks or the contents of forms. We do not create identified person profiles or link deliberately submitted feedback to a browsing identity.

**Cookieless visitor estimates.** PostHog is configured not to store analytics cookies or visitor identifiers in browser local or session storage. It uses the request IP address, browser user agent, site host, and calendar day to derive a short-lived visitor estimate on its servers. Raw client IP addresses are discarded from stored events under our project settings. These estimates do not establish who someone is: shared networks and different devices affect them, and a returning visitor may be counted again on another day. Cookieless analytics still involve processing request information; they are not a guarantee that no personal information is processed.

**Dataset searches.** We retain dataset search terms, including searches with no results, to discover unmet demand and decide which datasets to add. Terms are normalized for case and spacing and limited to 200 characters. We omit search text that exceeds that limit or matches common email, URL, phone-number, precise-coordinate, or street-address patterns. We still count those searches and their results, with a flag indicating that their text was omitted. This filtering is imperfect: personal names and unusual sensitive formats may still pass, and legitimate searches may be omitted. Please do not put personal or confidential information in dataset searches. Filtering affects analytics only; it does not prevent a search from working. Search text is retained on the dataset search event rather than duplicated in other analytics events or URLs.

**Download and agent statistics.** We distinguish download clicks, browser handoffs, confirmed completions, and failures. A handoff is not proof a file finished downloading. Actual byte measurements are available only for transfers handled by the application; direct and external downloads are not all measurable this way. Server analytics count API and discovery requests by route, HTTP method, response status, and client category. Agent provider, client, and purpose labels are derived from self-declared user agents, which are not retained in these server discovery events. Those labels do not verify an operator or identify distinct agents. These server events use a shared anonymous identity and do not include the requesting client's IP address, cookies, referrer, raw headers, or URL query strings.

**Your analytics choice.** You can turn optional analytics off or back on at https://hifld.publicenvirodata.org/privacy, reached through HIFLD Next's Privacy footer link. Turning analytics off saves only your choice in a preference cookie for one year; this cookie is not a visitor identifier. We also honor Do Not Track and Global Privacy Control signals. Browser privacy signals take precedence over the page control. Clearing cookies can reset your saved preference. Analytics preferences do not prevent you from searching for or downloading data, using the map, or deliberately submitting feedback.

**Feedback you choose to send.** The data-issue form requires an unchecked consent box before submission. With your consent, PEDP stores your email address, comment, dataset and version context, and any selected feature's attributes and centroid in PostHog so we can investigate and respond. The selected feature's full geometry is excluded. We record when consent was given and which notice version was shown. Reports are submitted independently of browser analytics and are not associated with the visitor's cookieless browsing identity. The form remains available when analytics are off and reports a delivery error if it cannot submit your report. Do not include confidential information in feedback.

**Provider, access, and retention.** PostHog is a service provider receiving analytics events and consented reports for these purposes; the HIFLD project uses PostHog's US cloud service. Authorized PEDP staff and service operators may access this information to maintain the service, assess dataset demand, or respond to reports. PEDP's commitments not to sell or rent personal information or publicly attribute people without consent also apply here. Information is kept for no longer than two years, and for less time when it is no longer needed for these purposes.

**Deletion and withdrawal.** Contact hello@publicenvirodata.org to request deletion of a feedback report or withdraw feedback consent. Provide the email address used with the report and enough context to locate it. You can stop optional analytics through the preference control above. Because cookieless visitor estimates are not linked to an email or stable browsing identity, it may not be possible to identify past analytics events belonging to a particular visitor from an email address alone.

External survey, donation, and other linked services may have their own collection practices and privacy notices.
