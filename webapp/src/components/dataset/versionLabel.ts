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

export function compareVersionValues(left: string | number, right: string | number): number {
  const leftValue = String(left);
  const rightValue = String(right);
  const leftSemver = parseSemverVersion(leftValue);
  const rightSemver = parseSemverVersion(rightValue);

  if (leftSemver && rightSemver) {
    for (let index = 0; index < leftSemver.length; index += 1) {
      const leftPart = leftSemver[index] ?? 0;
      const rightPart = rightSemver[index] ?? 0;
      const diff = rightPart - leftPart;
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }

  if (!Number.isNaN(Number(leftValue)) && !Number.isNaN(Number(rightValue))) {
    return Number(rightValue) - Number(leftValue);
  }

  return rightValue.localeCompare(leftValue);
}

function parseSemverVersion(value: string): [number, number, number] | null {
  const match = value.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  const [, major = "0", minor = "0", patch = "0"] = match;
  return [Number(major), Number(minor), Number(patch)];
}
