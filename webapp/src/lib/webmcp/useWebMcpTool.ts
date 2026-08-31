import { type MutableRefObject, useEffect, useRef } from "react";
import type { z } from "zod";
import {
  trackWebMcpToolCompleted,
  trackWebMcpToolFailed,
  trackWebMcpToolStarted,
  type WebMcpRouteKind,
} from "@/lib/analytics";
import { boundWebMcpResult, failure, type WebMcpJsonValue, type WebMcpResult } from "./result";
import { schemaToJsonSchema } from "./schemas";

type NavigatorWithModelContext = Navigator & { modelContext?: WebMCP.ModelContext };

function resolveModelContext(): WebMCP.ModelContext | undefined {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined") return (navigator as NavigatorWithModelContext).modelContext;
  return undefined;
}

export interface UseWebMcpToolOptions<TInput, TData extends WebMcpJsonValue> {
  name: string;
  title?: string;
  description: string;
  schema: z.ZodType<TInput>;
  execute: (input: TInput, signal: AbortSignal) => Promise<WebMcpResult<TData>> | WebMcpResult<TData>;
  enabled?: boolean;
  annotations?: WebMCP.ToolAnnotations;
  routeKind?: WebMcpRouteKind;
}

type RegisteredToolExecute = NonNullable<WebMCP.ModelContextTool["execute"]>;
type RegisteredToolInput = Parameters<RegisteredToolExecute>[0];
type RegisteredToolOptions = Parameters<RegisteredToolExecute>[1];

function currentTimeMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? createAbortError();
}

function isAbortError<T>(value: T): boolean {
  if (value instanceof Error && value.name === "AbortError") return true;
  return typeof DOMException !== "undefined" && value instanceof DOMException && value.name === "AbortError";
}

function rethrowAbortIfNeeded<T>(signal: AbortSignal, error: T): void {
  if (signal.aborted) throw signal.reason ?? createAbortError();
  if (isAbortError(error)) throw error;
}

async function executeRegisteredTool<TInput, TData extends WebMcpJsonValue>(
  input: RegisteredToolInput,
  options: RegisteredToolOptions,
  schema: z.ZodType<TInput>,
  executeRef: MutableRefObject<UseWebMcpToolOptions<TInput, TData>["execute"]>,
  name: string,
  routeKind: WebMcpRouteKind,
): Promise<WebMcpResult<TData> | WebMcpResult<WebMcpJsonValue>> {
  const startedAt = currentTimeMs();
  trackWebMcpToolStarted(name, routeKind);
  throwIfAborted(options.signal);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    trackWebMcpToolFailed(name, routeKind, currentTimeMs() - startedAt, "invalid_request");
    return failure("invalid_request", "The tool input is invalid.");
  }
  try {
    const result = await executeRef.current(parsed.data, options.signal);
    throwIfAborted(options.signal);
    const durationMs = currentTimeMs() - startedAt;
    if (result.ok) {
      trackWebMcpToolCompleted(name, routeKind, durationMs);
    } else {
      trackWebMcpToolFailed(name, routeKind, durationMs, result.error.code);
    }
    return boundWebMcpResult(result);
  } catch (error) {
    rethrowAbortIfNeeded(options.signal, error);
    const durationMs = currentTimeMs() - startedAt;
    trackWebMcpToolFailed(name, routeKind, durationMs, "internal_error");
    return failure("internal_error");
  }
}

function createAbortError(): Error {
  const error = new Error("The WebMCP tool execution was aborted.");
  error.name = "AbortError";
  return error;
}

export function useWebMcpTool<TInput, TData extends WebMcpJsonValue>({
  name,
  title,
  description,
  schema,
  execute,
  enabled = true,
  annotations,
  routeKind = "unknown",
}: UseWebMcpToolOptions<TInput, TData>): void {
  const executeRef = useRef(execute);
  const annotationsRef = useRef(annotations);
  executeRef.current = execute;
  annotationsRef.current = annotations;

  useEffect(() => {
    if (!enabled) return;

    const modelContext = resolveModelContext();
    if (!modelContext) return;
    const registrationController = new AbortController();
    const tool: WebMCP.ModelContextTool = {
      name,
      ...(title ? { title } : {}),
      description,
      inputSchema: schemaToJsonSchema(schema),
      ...(annotationsRef.current ? { annotations: annotationsRef.current } : {}),
      execute: async (input, options) => {
        return executeRegisteredTool(input, options, schema, executeRef, name, routeKind);
      },
    };

    void modelContext.registerTool(tool, { signal: registrationController.signal }).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return;
      console.error("WebMCP tool registration failed.");
    });
    return () => registrationController.abort();
  }, [description, enabled, name, routeKind, schema, title]);
}
