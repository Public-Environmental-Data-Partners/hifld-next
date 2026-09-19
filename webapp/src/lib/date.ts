export function formatOptionalDate(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString();
}
