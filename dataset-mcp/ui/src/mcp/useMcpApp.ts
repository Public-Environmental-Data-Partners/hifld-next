import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErrorResultSchema,
  type MapConfiguration,
  type QueryResult,
  QueryResultSchema,
} from "./contracts";

export interface McpAppState {
  app: McpApp | null;
  connected: boolean;
  error: string | null;
  result: QueryResult | null;
  mapConfiguration: MapConfiguration | null;
  staticMode: boolean;
  canCallServerTools: boolean;
  getQueryPage: (
    token: string,
    offset: number,
    pageSize?: number,
  ) => Promise<QueryResult>;
}

export function useMcpApp(): McpAppState {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [mapConfiguration, setMapConfiguration] =
    useState<MapConfiguration | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "hifld-dataset-explorer", version: "0.1.0" },
    capabilities: { tools: {} },
    autoResize: true,
    onAppCreated: (created) => {
      // Register lifecycle handlers before connect: hosts may send context immediately.
      created.ontoolresult = (params) => {
        const parsed = QueryResultSchema.safeParse(params.structuredContent);
        const value = parsed.success ? parsed.data : null;
        if (value) {
          setResult(value);
          setMapConfiguration(value.map_configuration ?? null);
          setBridgeError(null);
        } else {
          const stable = ErrorResultSchema.safeParse(params.structuredContent);
          setResult(null);
          setMapConfiguration(null);
          setBridgeError(
            stable.success
              ? stable.data.error.message
              : "The host returned an invalid dataset result.",
          );
        }
      };
      created.onerror = (event) => {
        setResult(null);
        setMapConfiguration(null);
        setBridgeError(event.message);
      };
      created.onhostcontextchanged = (context) => {
        if (context.theme)
          document.documentElement.dataset.theme = context.theme;
        if (context.styles)
          for (const [key, value] of Object.entries(context.styles))
            if (value) document.documentElement.style.setProperty(key, value);
      };
      created.onteardown = async () => ({});
    },
  });
  const staticMode = !isConnected;
  const canCallServerTools =
    app?.getHostCapabilities()?.serverTools !== undefined;
  const getQueryPage = useCallback(
    async (
      token: string,
      offset: number,
      pageSize = 100,
    ): Promise<QueryResult> => {
      if (!app || !canCallServerTools)
        throw new Error("This host cannot call server tools.");
      const response = await app.callServerTool({
        name: "get_query_page",
        arguments: { query_token: token, offset, page_size: pageSize },
      });
      const parsed = QueryResultSchema.safeParse(response.structuredContent);
      if (!parsed.success)
        throw new Error("The host returned an invalid query page.");
      return parsed.data;
    },
    [app, canCallServerTools],
  );
  return useMemo(
    () => ({
      app,
      connected: isConnected,
      error: bridgeError ?? error?.message ?? null,
      result,
      mapConfiguration,
      staticMode,
      canCallServerTools,
      getQueryPage,
    }),
    [
      app,
      bridgeError,
      canCallServerTools,
      error,
      isConnected,
      result,
      mapConfiguration,
      staticMode,
      getQueryPage,
    ],
  );
}

export function useVisibilityPause(
  onVisible: (visible: boolean) => void,
): void {
  useEffect(() => {
    const handler = () => onVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [onVisible]);
}
