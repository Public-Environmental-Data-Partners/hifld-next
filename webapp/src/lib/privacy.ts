export const PEDP_PRIVACY_URL = "https://www.publicenvirodata.org/privacy-policy";
export const FEEDBACK_CONSENT_VERSION = "2026-11-04";

/** This preference cookie is only written after an explicit choice, never as an identifier. */
export function analyticsDisabled(headers?: Headers): boolean {
  if (headers) {
    return (
      headers.get("DNT") === "1" ||
      headers.get("Sec-GPC") === "1" ||
      /(?:^|;\s*)hifld_analytics=off(?:;|$)/.test(headers.get("cookie") ?? "")
    );
  }
  if (typeof window === "undefined") return true;
  return (
    navigator.doNotTrack === "1" ||
    Reflect.get(navigator, "globalPrivacyControl") === true ||
    /(?:^|;\s*)hifld_analytics=off(?:;|$)/.test(document.cookie)
  );
}

export function withoutUrlQuery(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? "";
}
