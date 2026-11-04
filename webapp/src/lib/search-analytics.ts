/** Best-effort minimization, not anonymization: names and unusual formats can still pass. */
export function searchQueryForAnalytics(input: string): string | undefined {
  const query = input.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (!query || query.length > 200) return undefined;
  if (/@|https?:\/\/|www\./iu.test(query)) return undefined;
  if (/(?:\+?\d[\s().-]*){9,}\d/u.test(query)) return undefined;
  if (/-?\d{1,3}\.\d{3,}/u.test(query)) return undefined;
  if (
    /\b\d{1,6}\s+(?:[\p{L}\d.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way|place|pl)\b/iu.test(
      query,
    )
  )
    return undefined;
  return query;
}
