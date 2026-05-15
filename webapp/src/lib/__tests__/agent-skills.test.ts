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
});
