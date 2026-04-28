import { createHash } from "node:crypto";

/** SKILL.md body for `hifld-catalog` (digest must match bytes served at `url`). */
export const HIFLD_CATALOG_SKILL_MD = `# HIFLD Next catalog

Use this skill when you need to explore **collections**, **datasets**, and **files** from the preserved HIFLD Open catalog via the webapp JSON API.

## Before you call paths

1. \`GET /api\` — bootstrap JSON with \`links\` (OpenAPI, \`llms.txt\`, collections list hints).
2. \`GET /api/openapi\` — OpenAPI 3.1 for all supported routes.
3. Read \`/llms.txt\` for human-oriented URL patterns and conventions.

## Discovery

- \`GET /.well-known/api-catalog\` — RFC 9727 API catalog (\`application/linkset+json\`): anchor + \`service-desc\`, \`service-doc\`, \`status\`.
- \`GET /.well-known/agent-skills/index.json\` — Agent Skills discovery (this index).

## Typical flow

1. \`GET /api/collections\` — list collections.
2. \`GET /api/collections/{slug}/datasets\` — datasets in a collection (see OpenAPI for query params).
3. Follow \`links\` and relation URLs from responses rather than inventing path shapes.

Unknown paths under \`/api\` return \`404\` with \`application/problem+json\` and links back to \`/api\` and OpenAPI.
`;

export function skillArtifactDigest(markdown: string): string {
  return (
    "sha256:" +
    createHash("sha256").update(markdown, "utf8").digest("hex")
  );
}

/** Agent Skills Discovery index (RFC v0.2.0 style). */
export function buildAgentSkillsIndex(origin: string) {
  const skillUrl = `${origin}/.well-known/agent-skills/hifld-catalog/SKILL.md`;
  return {
    $schema:
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "hifld-catalog",
        type: "skill-md",
        description:
          "Browse HIFLD Next collections and datasets using the JSON API, OpenAPI, and discovery documents.",
        url: skillUrl,
        digest: skillArtifactDigest(HIFLD_CATALOG_SKILL_MD),
      },
    ],
  };
}
