import type { App } from "@modelcontextprotocol/ext-apps";

export type LayerLoadStatus = "loading" | "loaded" | "failed" | "hidden";
export type LayerStatus = {
  layer_name: string;
  status: LayerLoadStatus;
  error?: string;
};
export type MapStatus = {
  map_title?: string;
  status: "loading" | "loaded" | "partial" | "failed";
  scope?: "current_viewport";
  layers: LayerStatus[];
  error?: string;
};

export const FEEDBACK_UNAVAILABLE =
  "The host could not receive map status updates. Share this widget's status or error with the agent.";

export async function publishMapStatus(
  app: Pick<App, "getHostCapabilities" | "updateModelContext"> | null,
  snapshot: MapStatus,
): Promise<"updated" | "unsupported" | "rejected"> {
  const capability = app?.getHostCapabilities()?.updateModelContext;
  if (!app || (!capability?.text && !capability?.structuredContent)) {
    return "unsupported";
  }
  try {
    await app.updateModelContext({
      ...(capability.text
        ? {
            content: [
              {
                type: "text" as const,
                text: `Map runtime status (loaded means current viewport only): ${JSON.stringify(snapshot)}`,
              },
            ],
          }
        : {}),
      ...(capability.structuredContent
        ? { structuredContent: { map_status: snapshot } }
        : {}),
    });
    return "updated";
  } catch {
    return "rejected";
  }
}
