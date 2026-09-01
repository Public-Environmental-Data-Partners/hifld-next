import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ErrorResultSchema,
  type MapConfiguration,
  type MapDefinition,
  type MapResult,
  MapResultSchema,
} from "./contracts";

const TOKEN_REFRESH_LEAD_MS = 30_000;

function runtimeConfiguration(result: MapResult): MapConfiguration {
  return {
    title: result.title,
    basemap: result.basemap,
    worker_url: result.worker_url,
    ...(result.camera === undefined ? {} : { camera: result.camera }),
    layers: result.layers.map(({ expires_at: _expiresAt, ...layer }) => layer),
  };
}

function earliestExpiration(result: MapResult): number {
  return Math.min(
    ...result.layers.map((layer) => Date.parse(layer.expires_at)),
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
            result.layers.map((layer) => [layer.query_id, layer.query_token]),
          ),
        );
        setBridgeError(null);
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
            name: "refresh_query_map",
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
              : "The server returned an invalid refreshed map.",
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
            : "The host returned an invalid map result.",
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
