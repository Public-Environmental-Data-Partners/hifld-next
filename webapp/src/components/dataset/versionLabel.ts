export function formatVersionLabel(version: string | number | null | undefined): string {
  if (version == null) {
    return "";
  }

  const normalized = String(version);
  if (normalized.match(/^\d{4}-\d{2}-\d{2}$/) || normalized.startsWith("v")) {
    return normalized;
  }

  return `v${normalized}`;
}

export function parseVersionValue(value: string): string | number {
  if (value.match(/^\d{4}-\d{2}-\d{2}$/) || value.startsWith("v")) {
    return value;
  }

  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

export function compareVersionValues(
  left: string | number,
  right: string | number
): number {
  const leftValue = String(left);
  const rightValue = String(right);

  if (!Number.isNaN(Number(leftValue)) && !Number.isNaN(Number(rightValue))) {
    return Number(rightValue) - Number(leftValue);
  }

  return rightValue.localeCompare(leftValue);
}
