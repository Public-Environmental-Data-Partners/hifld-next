import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import {
  ErrorResultSchema,
  type MapConfiguration,
  type MapDefinition,
  type MapResult,
  MapResultSchema,
} from "./contracts";

const TOKEN_REFRESH_LEAD_MS = 30_000;

function invalidMapMessage(issues: readonly z.core.$ZodIssue[]): string {
  const fields = (
    items: readonly z.core.$ZodIssue[],
    prefix: readonly PropertyKey[] = [],
  ): string[] =>
    items.flatMap((issue) => {
      const path = [...prefix, ...issue.path];
      return issue.code === "invalid_union"
        ? issue.errors.flatMap((branch) => fields(branch, path))
        : [`${path.join(".") || "structuredContent"} (${issue.code})`];
    });
  // Only schema paths and codes: never echo SQL, tokens, or rejected values.
  const details = [...new Set(fields(issues))].slice(0, 8).join(", ");
  return (
    `Invalid map result: the widget could not validate the map configuration. ${details}. ` +
    "This is not a SQL execution error. Reopen the map with the current MCP connection; " +
    "if it persists, report these field paths. Do not rewrite SQL to fix this error."
  );
}

function runtimeConfiguration(result: MapResult): MapConfiguration {
  return {
    title: result.title,
    basemap: result.basemap,
    worker_url: result.worker_url,
    ...(result.camera === undefined ? {} : { camera: result.camera }),
    layers: result.layers.map((layer) => {
      if (!("expires_at" in layer)) return layer;
      const { expires_at: _expiresAt, ...configuration } = layer;
      return configuration;
    }),
  };
}

function earliestExpiration(result: MapResult): number {
  return Math.min(
    ...result.layers.flatMap((layer) =>
      "expires_at" in layer ? [Date.parse(layer.expires_at)] : [],
    ),
  );
}

export interface McpMapState {
  app: McpApp | null;
  error: string | null;
  mapConfiguration: MapConfiguration | null;
  queryTokens: Record<string, string>;
  registerTeardownHandler: (handler: (() => Promise<void>) | null) => void;
}

export function useMcpApp(): McpMapState {
  const teardownHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapSequenceRef = useRef(0);
  const [mapConfiguration, setMapConfiguration] =
    useState<MapConfiguration | null>(null);
  const [queryTokens, setQueryTokens] = useState<Record<string, string>>({});
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const { app, error } = useApp({
    appInfo: { name: "hifld-query-map", version: "0.1.0" },
    capabilities: {},
    autoResize: true,
    onAppCreated: (created) => {
      const clearRefreshTimer = () => {
        if (refreshTimerRef.current !== null) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      };
      const failMap = (message: string) => {
        clearRefreshTimer();
        setMapConfiguration(null);
        setQueryTokens({});
        setBridgeError(message);
      };
      const acceptMapResult = (result: MapResult, sequence: number) => {
        if (sequence !== mapSequenceRef.current) return;
        clearRefreshTimer();
        const expiresAt = earliestExpiration(result);
        if (expiresAt <= Date.now()) {
          void refreshMap(result.map_spec, sequence);
          return;
        }
        setMapConfiguration(runtimeConfiguration(result));
        setQueryTokens(
          Object.fromEntries(
            result.layers.flatMap((layer) =>
              "query_id" in layer ? [[layer.query_id, layer.query_token]] : [],
            ),
          ),
        );
        setBridgeError(null);
        if (!Number.isFinite(expiresAt)) return;
        const refreshDelay = Math.max(
          0,
          expiresAt - Date.now() - TOKEN_REFRESH_LEAD_MS,
        );
        refreshTimerRef.current = setTimeout(() => {
          void refreshMap(result.map_spec, sequence);
        }, refreshDelay);
      };
      const refreshMap = async (
        mapSpec: MapDefinition,
        sequence: number,
      ): Promise<void> => {
        if (sequence !== mapSequenceRef.current) return;
        try {
          const response = await created.callServerTool({
            name: mapSpec.layers.some((layer) => "source" in layer)
              ? "refresh_map"
              : "refresh_query_map",
            arguments: { map_spec: mapSpec },
          });
          if (sequence !== mapSequenceRef.current) return;
          const parsed = MapResultSchema.safeParse(response.structuredContent);
          if (parsed.success) {
            acceptMapResult(parsed.data, sequence);
            return;
          }
          const stable = ErrorResultSchema.safeParse(
            response.structuredContent,
          );
          failMap(
            stable.success
              ? stable.data.error.message
              : invalidMapMessage(parsed.error.issues),
          );
        } catch {
          if (sequence === mapSequenceRef.current) {
            failMap(
              "This MCP host could not refresh the map's expired query tokens.",
            );
          }
        }
      };
      created.ontoolresult = (params) => {
        const sequence = mapSequenceRef.current + 1;
        mapSequenceRef.current = sequence;
        const parsed = MapResultSchema.safeParse(params.structuredContent);
        if (parsed.success) {
          acceptMapResult(parsed.data, sequence);
          return;
        }
        const stable = ErrorResultSchema.safeParse(params.structuredContent);
        failMap(
          stable.success
            ? stable.data.error.message
            : invalidMapMessage(parsed.error.issues),
        );
      };
      created.onerror = (event) => {
        mapSequenceRef.current += 1;
        failMap(event.message);
      };
      created.onteardown = async () => {
        clearRefreshTimer();
        await teardownHandlerRef.current?.();
        return {};
      };
    },
  });
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );
  useHostStyles(app, app?.getHostContext());
  const registerTeardownHandler = useCallback(
    (handler: (() => Promise<void>) | null) => {
      teardownHandlerRef.current = handler;
    },
    [],
  );

  return useMemo(
    () => ({
      app,
      error: bridgeError ?? error?.message ?? null,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    }),
    [
      app,
      bridgeError,
      error,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    ],
  );
}
