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
  PreparedMapLayerResultSchema,
} from "./contracts";
import {
  FEEDBACK_UNAVAILABLE,
  type MapStatus,
  publishMapStatus,
} from "./mapStatus";

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
  refreshExpiredToken: (queryId: string, token: string) => Promise<void>;
  reportStatus: (status: MapStatus) => Promise<void>;
  feedbackNotice: string | null;
  app: McpApp | null;
  error: string | null;
  mapConfiguration: MapConfiguration | null;
  queryTokens: Record<string, string>;
  registerTeardownHandler: (handler: (() => Promise<void>) | null) => void;
}

export function useMcpApp(): McpMapState {
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const teardownHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const refreshExpiredRef = useRef<McpMapState["refreshExpiredToken"]>(
    async () => {},
  );
  const tokensRef = useRef<Record<string, string>>({});
  const mapSequenceRef = useRef(0);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const [mapConfiguration, setMapConfiguration] =
    useState<MapConfiguration | null>(null);
  const [queryTokens, setQueryTokens] = useState<Record<string, string>>({});
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const { app, error } = useApp({
    appInfo: { name: "hifld-query-map", version: "0.1.0" },
    capabilities: {},
    autoResize: true,
    onAppCreated: (created) => {
      const cancelPreparation = () => {
        preparationAbortRef.current?.abort();
        preparationAbortRef.current = null;
      };
      const failMap = (message: string, validation = false) => {
        refreshExpiredRef.current = async () => {};
        tokensRef.current = {};
        cancelPreparation();
        setMapConfiguration(null);
        setQueryTokens({});
        setBridgeError(message);
        const sequence = mapSequenceRef.current;
        void publishMapStatus(created, {
          status: "failed",
          layers: [],
          error: validation
            ? `validation_failed: ${message}`
            : "map_failed: the widget could not open or refresh the map. Inspect the widget error.",
        }).then((status) => {
          if (status !== "updated" && sequence === mapSequenceRef.current) {
            setBridgeError(`${message} ${FEEDBACK_UNAVAILABLE}`);
          }
        });
      };
      const acceptMapResult = (result: MapResult, sequence: number) => {
        if (sequence !== mapSequenceRef.current) return;
        refreshExpiredRef.current = async (queryId, token) => {
          if (
            sequence !== mapSequenceRef.current ||
            tokensRef.current[queryId] !== token
          )
            return;
          await refreshMap(result.map_spec, sequence);
        };
        if (result.layers.some((layer) => "preparation_status" in layer)) {
          cancelPreparation();
          const controller = new AbortController();
          preparationAbortRef.current = controller;
          let current = result;
          const publish = () => {
            if (
              controller.signal.aborted ||
              sequence !== mapSequenceRef.current
            )
              return;
            setMapConfiguration(runtimeConfiguration(current));
            tokensRef.current = Object.fromEntries(
              current.layers.flatMap((layer) =>
                "query_id" in layer
                  ? [[layer.query_id, layer.query_token]]
                  : [],
              ),
            );
            setQueryTokens(
              Object.fromEntries(
                current.layers.flatMap((layer) =>
                  "query_id" in layer
                    ? [[layer.query_id, layer.query_token]]
                    : [],
                ),
              ),
            );
            setBridgeError(null);
          };
          const prepare = async (index: number): Promise<void> => {
            const spec = result.map_spec.layers[index];
            const original = result.layers[index];
            if (
              !spec ||
              !("source" in spec) ||
              spec.source.type !== "query" ||
              !original ||
              !("preparation_status" in original)
            )
              return;
            const replace = (layer: MapResult["layers"][number]) => {
              current = {
                ...current,
                layers: current.layers.map((existing, position) =>
                  position === index ? layer : existing,
                ),
              };
              publish();
            };
            replace({ ...original, preparation_status: "preparing" });
            const fail = (message: string) => {
              replace({
                ...original,
                preparation_status: "failed",
                preparation_error: message,
              });
            };
            try {
              const response = await created.callServerTool(
                {
                  name: "prepare_map_layer",
                  arguments: { layer: spec },
                },
                { signal: controller.signal },
              );
              if (
                controller.signal.aborted ||
                sequence !== mapSequenceRef.current
              )
                return;
              const parsed = PreparedMapLayerResultSchema.safeParse(
                response.structuredContent,
              );
              if (
                !parsed.success ||
                parsed.data.layer.layer_name !== original.layer_name
              ) {
                const stable = ErrorResultSchema.safeParse(
                  response.structuredContent,
                );
                fail(
                  stable.success
                    ? `${stable.data.error.message} (${stable.data.error.code})`
                    : "The prepared layer did not match the map contract. Reopen the map with the current MCP connection.",
                );
                return;
              }
              const expiresAt = Date.parse(parsed.data.layer.expires_at);
              if (expiresAt <= Date.now()) {
                fail(
                  "The prepared query token has expired. Reopen the map to retry.",
                );
                return;
              }
              replace(parsed.data.layer);
            } catch {
              if (
                controller.signal.aborted ||
                sequence !== mapSequenceRef.current
              )
                return;
              fail(
                "The host could not prepare this query layer. Reopen the map to retry.",
              );
            }
          };
          publish();
          result.layers.forEach((layer, index) => {
            if (
              "preparation_status" in layer &&
              layer.preparation_status === "preparing"
            )
              void prepare(index);
          });
          return;
        }
        const expiresAt = earliestExpiration(result);
        if (expiresAt <= Date.now()) {
          void refreshMap(result.map_spec, sequence);
          return;
        }
        setMapConfiguration(runtimeConfiguration(result));
        tokensRef.current = Object.fromEntries(
          result.layers.flatMap((layer) =>
            "query_id" in layer ? [[layer.query_id, layer.query_token]] : [],
          ),
        );
        setQueryTokens(
          Object.fromEntries(
            result.layers.flatMap((layer) =>
              "query_id" in layer ? [[layer.query_id, layer.query_token]] : [],
            ),
          ),
        );
        setBridgeError(null);
      };
      let refreshing: { sequence: number; promise: Promise<void> } | null =
        null;
      const refreshMap = async (
        mapSpec: MapDefinition,
        sequence: number,
      ): Promise<void> => {
        if (sequence !== mapSequenceRef.current) return;
        if (refreshing?.sequence === sequence) return refreshing.promise;
        const promise = performRefresh(mapSpec, sequence);
        refreshing = { sequence, promise };
        try {
          await promise;
        } finally {
          if (refreshing?.promise === promise) refreshing = null;
        }
      };
      const performRefresh = async (
        mapSpec: MapDefinition,
        sequence: number,
      ): Promise<void> => {
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
            if (earliestExpiration(parsed.data) <= Date.now()) {
              failMap(
                "The server returned an expired replacement query token. Reopen the map to retry.",
              );
              return;
            }
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
            !stable.success,
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
        cancelPreparation();
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
          !stable.success,
        );
      };
      created.onerror = (event) => {
        mapSequenceRef.current += 1;
        failMap(event.message);
      };
      created.onteardown = async () => {
        mapSequenceRef.current += 1;
        cancelPreparation();
        refreshExpiredRef.current = async () => {};
        await teardownHandlerRef.current?.();
        return {};
      };
    },
  });
  useEffect(
    () => () => {
      mapSequenceRef.current += 1;
      preparationAbortRef.current?.abort();
      refreshExpiredRef.current = async () => {};
    },
    [],
  );
  useHostStyles(app, app?.getHostContext());
  const refreshExpiredToken = useCallback<McpMapState["refreshExpiredToken"]>(
    (queryId, token) => refreshExpiredRef.current(queryId, token),
    [],
  );
  const reportStatus = useCallback(
    async (status: MapStatus) => {
      const sequence = mapSequenceRef.current;
      const delivery = await publishMapStatus(app, status);
      if (sequence === mapSequenceRef.current) {
        setFeedbackNotice(delivery === "updated" ? null : FEEDBACK_UNAVAILABLE);
      }
    },
    [app],
  );
  const registerTeardownHandler = useCallback(
    (handler: (() => Promise<void>) | null) => {
      teardownHandlerRef.current = handler;
    },
    [],
  );

  return useMemo(
    () => ({
      refreshExpiredToken,
      reportStatus,
      feedbackNotice,
      app,
      error: bridgeError ?? error?.message ?? null,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    }),
    [
      refreshExpiredToken,
      reportStatus,
      feedbackNotice,
      app,
      bridgeError,
      error,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    ],
  );
}
