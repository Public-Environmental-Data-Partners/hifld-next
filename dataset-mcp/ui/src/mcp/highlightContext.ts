import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type { MapHighlightSnapshot } from "../components/mapSelection";

export type { MapHighlightSnapshot } from "../components/mapSelection";

export type HighlightContextUpdateStatus =
  | "updated"
  | "unsupported"
  | "rejected";

export interface HighlightContextUpdateResult {
  status: HighlightContextUpdateStatus;
}

type HighlightContextApp = Pick<
  McpApp,
  "getHostCapabilities" | "updateModelContext"
>;

function serializedUntrustedProperties(
  properties: Record<string, string>,
): string {
  return JSON.stringify(properties)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function highlightContextText(snapshot: MapHighlightSnapshot): string {
  const countLabel =
    snapshot.selected_feature_count === 1 ? "feature" : "features";
  const lines = [
    `Map highlight selection: ${snapshot.selected_feature_count} ${countLabel} selected.`,
    `map_title: ${JSON.stringify(snapshot.map_title)}`,
    ...(snapshot.was_capped
      ? ["The selection was capped at 100 features per query layer."]
      : []),
    ...(snapshot.selection_bounds
      ? [`Selection bounds: [${snapshot.selection_bounds.join(", ")}].`]
      : []),
  ];
  for (const feature of snapshot.selected_features) {
    lines.push("- selected_feature:");
    lines.push(`  id: ${JSON.stringify(feature.id)}`);
    lines.push(`  query_id: ${JSON.stringify(feature.query_id)}`);
    lines.push(`  layer_name: ${JSON.stringify(feature.layer_name)}`);
    lines.push(`  source_layer_id: ${JSON.stringify(feature.source_layer_id)}`);
    lines.push(`  feature_id: ${JSON.stringify(feature.feature_id)}`);
    lines.push(
      `  centroid: ${feature.centroid ? `[${feature.centroid.join(", ")}]` : "null"}`,
    );
    lines.push('  <untrusted-map-properties encoding="json">');
    lines.push(`  ${serializedUntrustedProperties(feature.properties)}`);
    lines.push("  </untrusted-map-properties>");
  }
  return lines.join("\n");
}

export async function updateHighlightContext(
  app: HighlightContextApp | null,
  snapshot: MapHighlightSnapshot,
): Promise<HighlightContextUpdateResult> {
  const capability = app?.getHostCapabilities()?.updateModelContext;
  if (
    !app ||
    !capability ||
    (!capability.text && !capability.structuredContent)
  ) {
    return { status: "unsupported" };
  }
  const params = {
    ...(capability.text
      ? {
          content: [
            { type: "text" as const, text: highlightContextText(snapshot) },
          ],
        }
      : {}),
    ...(capability.structuredContent
      ? { structuredContent: { map_highlight: snapshot } }
      : {}),
  };
  try {
    await app.updateModelContext(params);
    return { status: "updated" };
  } catch {
    return { status: "rejected" };
  }
}
