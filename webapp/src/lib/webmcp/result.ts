export type WebMcpJsonPrimitive = string | number | boolean | null;
export type WebMcpJsonObject = { [key: string]: WebMcpJsonValue };
export type WebMcpJsonValue = WebMcpJsonPrimitive | WebMcpJsonValue[] | WebMcpJsonObject;

export type WebMcpSuccess<TData extends WebMcpJsonValue> = {
  ok: true;
  summary: string;
  data: TData;
  truncated?: true;
};

export type WebMcpErrorCode =
  | "invalid_request"
  | "not_found"
  | "unsupported_state"
  | "query_rejected"
  | "query_timeout"
  | "query_capacity"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export type WebMcpFailure = {
  ok: false;
  error: { code: WebMcpErrorCode; message: string; retryable: boolean };
};

export type WebMcpResult<TData extends WebMcpJsonValue> = WebMcpSuccess<TData> | WebMcpFailure;

const DEFAULT_INTERNAL_ERROR = "The tool could not complete the request.";
const MAX_SERIALIZED_RESULT_LENGTH = 1500;

const RETRYABLE_CODES: ReadonlySet<WebMcpErrorCode> = new Set([
  "query_timeout",
  "query_capacity",
  "rate_limited",
  "upstream_unavailable",
]);

export function success<TData extends WebMcpJsonValue>(summary: string, data: TData): WebMcpSuccess<TData> {
  return { ok: true, summary, data };
}

export function failure(code: WebMcpErrorCode, message = DEFAULT_INTERNAL_ERROR): WebMcpFailure {
  return { ok: false, error: { code, message, retryable: RETRYABLE_CODES.has(code) } };
}

function truncateString(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function isJsonObject(value: WebMcpJsonValue): value is WebMcpJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializedLength(result: WebMcpSuccess<WebMcpJsonValue>): number {
  return JSON.stringify(result).length;
}

function fitsData(data: WebMcpJsonValue, summary: string): boolean {
  return serializedLength({ ok: true, summary, data, truncated: true }) <= MAX_SERIALIZED_RESULT_LENGTH;
}

function compactArray(data: WebMcpJsonValue[], summary: string): WebMcpJsonValue[] {
  const output: WebMcpJsonValue[] = [];
  for (const item of data) {
    const compactedItem = compactValue(item, summary);
    const candidate = [...output, compactedItem];
    if (fitsData(candidate, summary)) output.push(compactedItem);
  }
  return output;
}

function compactObject(data: WebMcpJsonObject, summary: string): WebMcpJsonObject {
  const output: WebMcpJsonObject = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value === undefined) continue;
    const compactedValue = compactValue(value, summary);
    const candidate = { ...output, [key]: compactedValue };
    if (fitsData(candidate, summary)) output[key] = compactedValue;
  }
  return output;
}

function compactValue(value: WebMcpJsonValue, summary: string): WebMcpJsonValue {
  if (Array.isArray(value)) return compactArray(value, summary);
  if (isJsonObject(value)) return compactObject(value, summary);
  return value;
}

function compactData(data: WebMcpJsonValue, summary: string): WebMcpJsonValue {
  const compacted = compactValue(data, summary);
  if (typeof compacted === "string" && !fitsData(compacted, summary)) return null;
  return compacted;
}

function fitSuccess<TData extends WebMcpJsonValue>(result: WebMcpSuccess<TData>): WebMcpSuccess<WebMcpJsonValue> {
  for (let summaryLength = 200; summaryLength >= 0; summaryLength -= 20) {
    const summary = truncateString(result.summary, summaryLength);
    const summaryWasTruncated = summary !== result.summary;
    const original: WebMcpSuccess<WebMcpJsonValue> = {
      ok: true,
      summary,
      data: result.data,
      ...(summaryWasTruncated ? { truncated: true } : {}),
    };
    if (serializedLength(original) <= MAX_SERIALIZED_RESULT_LENGTH) return original;

    const compacted: WebMcpSuccess<WebMcpJsonValue> = {
      ok: true,
      summary,
      data: compactData(result.data, summary),
      truncated: true,
    };
    if (serializedLength(compacted) <= MAX_SERIALIZED_RESULT_LENGTH) return compacted;
  }

  return { ok: true, summary: "", data: null, truncated: true };
}

export function boundWebMcpResult<TData extends WebMcpJsonValue>(
  result: WebMcpResult<TData>,
): WebMcpResult<WebMcpJsonValue> {
  if (!result.ok) return result;
  return fitSuccess(result);
}

export { DEFAULT_INTERNAL_ERROR, MAX_SERIALIZED_RESULT_LENGTH };
