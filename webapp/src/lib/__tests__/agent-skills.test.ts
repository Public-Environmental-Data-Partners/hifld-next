import { describe, expect, it } from "vitest";
import {
  HIFLD_CATALOG_SKILL_MD,
  buildAgentSkillsIndex,
  skillArtifactDigest,
} from "../agent-skills";

describe("agent-skills discovery", () => {
  it("buildAgentSkillsIndex includes $schema and skills entries", () => {
    const idx = buildAgentSkillsIndex("https://example.org");
    expect(idx.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(idx.skills).toHaveLength(1);
    const s = idx.skills[0]!;
    expect(s.name).toBe("hifld-catalog");
    expect(s.type).toBe("skill-md");
    expect(s.description.length).toBeGreaterThan(10);
    expect(s.url).toBe(
      "https://example.org/.well-known/agent-skills/hifld-catalog/SKILL.md",
    );
    expect(s.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("digest matches SKILL.md bytes", () => {
    expect(skillArtifactDigest(HIFLD_CATALOG_SKILL_MD)).toBe(
      skillArtifactDigest(HIFLD_CATALOG_SKILL_MD),
    );
    const idx = buildAgentSkillsIndex("https://x.test");
    expect(idx.skills[0]!.digest).toBe(
      skillArtifactDigest(HIFLD_CATALOG_SKILL_MD),
    );
  });

  it("documents collection-first catalog and contextual WebMCP workflows", () => {
    expect(HIFLD_CATALOG_SKILL_MD).toContain("GET /api");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("GET /api/openapi");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("GET /api/collections/{slug}");
    expect(HIFLD_CATALOG_SKILL_MD).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}",
    );
    expect(HIFLD_CATALOG_SKILL_MD).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}",
    );
    expect(HIFLD_CATALOG_SKILL_MD).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema",
    );
    expect(HIFLD_CATALOG_SKILL_MD).toContain("latest schema-capable version");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("source URLs");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("GeoParquet");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("no `/items`, `/features`");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("read-only");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("JSON API remains read-only");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("current browser workspace");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("collection-first");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("X-HIFLD-Query-Token");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("POST /api/queries");
    expect(HIFLD_CATALOG_SKILL_MD).toContain(
      "POST /api/queries/{query_id}/pages",
    );
  });

  it("lists exactly the 19 contextual WebMCP tools", () => {
    const tools = [
      "list_collections",
      "get_collection",
      "search_datasets",
      "get_dataset",
      "get_dataset_file",
      "get_dataset_file_schema",
      "compare_file_versions",
      "get_map_state",
      "add_dataset_layer",
      "remove_map_layer",
      "set_layer_visibility",
      "set_layer_style",
      "reorder_map_layers",
      "set_map_camera",
      "set_basemap",
      "get_map_selection",
      "clear_map_selection",
      "run_dataset_query",
      "set_result_page",
    ];
    expect(tools).toHaveLength(19);
    for (const tool of tools) expect(HIFLD_CATALOG_SKILL_MD).toContain(`\`${tool}\``);
  });

  it("does not document the stale collection dataset-listing route", () => {
    expect(HIFLD_CATALOG_SKILL_MD).not.toContain("`GET /api/collections/{slug}/datasets`");
  });

  it("documents scanner discovery and native WebMCP compatibility", () => {
    expect(HIFLD_CATALOG_SKILL_MD).toContain("/.well-known/mcp/server-card.json");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("/.well-known/ai-catalog.json");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("GET /mcp");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("DATASET_MCP_PUBLIC_ENDPOINT");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("document.modelContext");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("navigator.modelContext");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("without a polyfill");
    expect(HIFLD_CATALOG_SKILL_MD).toContain("Scanner acceptance");
  });
});
