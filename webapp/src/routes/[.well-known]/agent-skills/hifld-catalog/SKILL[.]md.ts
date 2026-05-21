import { createFileRoute } from "@tanstack/react-router";
import { HIFLD_CATALOG_SKILL_MD } from "@/lib/agent-skills";

export const Route = createFileRoute("/.well-known/agent-skills/hifld-catalog/SKILL.md")({
  server: {
    handlers: {
      GET: () =>
        new Response(HIFLD_CATALOG_SKILL_MD, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
