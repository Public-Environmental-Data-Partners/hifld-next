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
  const [refreshNotices, setRefreshNotices] = useState<Record<string, string>>(
    {},
  );
  const teardownHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapSequenceRef = useRef(0);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const layerRefreshTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>(),
  );
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
      const cancelPreparation = () => {
        preparationAbortRef.current?.abort();
        preparationAbortRef.current = null;
        for (const timer of layerRefreshTimersRef.current.values())
          clearTimeout(timer);
        layerRefreshTimersRef.current.clear();
        setRefreshNotices({});
      };
      const failMap = (message: string, validation = false) => {
        clearRefreshTimer();
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
        clearRefreshTimer();
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
            const schedule = (callback: () => void, delay: number) => {
              const previousTimer = layerRefreshTimersRef.current.get(index);
              if (previousTimer !== undefined) clearTimeout(previousTimer);
              layerRefreshTimersRef.current.set(
                index,
                setTimeout(() => {
                  layerRefreshTimersRef.current.delete(index);
                  if (
                    !controller.signal.aborted &&
                    sequence === mapSequenceRef.current
                  )
                    callback();
                }, delay),
              );
            };
            const previous = current.layers[index];
            const previousExpiry =
              previous && "expires_at" in previous
                ? Date.parse(previous.expires_at)
                : 0;
            const preparing = () =>
              replace({ ...original, preparation_status: "preparing" });
            if (previousExpiry > Date.now())
              schedule(preparing, previousExpiry - Date.now());
            else preparing();
            const clearNotice = () =>
              setRefreshNotices((notices) =>
                Object.fromEntries(
                  Object.entries(notices).filter(
                    ([name]) => name !== original.layer_name,
                  ),
                ),
              );
            const fail = (message: string) => {
              const failed = () => {
                clearNotice();
                replace({
                  ...original,
                  preparation_status: "failed",
                  preparation_error: message,
                });
              };
              if (previousExpiry > Date.now()) {
                setRefreshNotices((notices) => ({
                  ...notices,
                  [original.layer_name]: `${original.layer_name}: refresh failed. The existing layer remains available until its token expires. Reopen the map to retry.`,
                }));
                schedule(failed, previousExpiry - Date.now());
              } else failed();
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
              clearNotice();
              schedule(
                () => {
                  void prepare(index);
                },
                Math.max(1000, expiresAt - Date.now() - TOKEN_REFRESH_LEAD_MS),
              );
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
        clearRefreshTimer();
        await teardownHandlerRef.current?.();
        return {};
      };
    },
  });
  useEffect(
    () => () => {
      mapSequenceRef.current += 1;
      preparationAbortRef.current?.abort();
      for (const timer of layerRefreshTimersRef.current.values())
        clearTimeout(timer);
      layerRefreshTimersRef.current.clear();
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );
  useHostStyles(app, app?.getHostContext());
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
      reportStatus,
      feedbackNotice:
        [
          ...Object.values(refreshNotices),
          ...(feedbackNotice ? [feedbackNotice] : []),
        ].join(" ") || null,
      app,
      error: bridgeError ?? error?.message ?? null,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    }),
    [
      reportStatus,
      feedbackNotice,
      refreshNotices,
      app,
      bridgeError,
      error,
      mapConfiguration,
      queryTokens,
      registerTeardownHandler,
    ],
  );
}
