import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";
import { buildCatalogSitemapXml, buildStaticSitemapXml } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        let sitemapXml: string;
        try {
          sitemapXml = await buildCatalogSitemapXml(origin);
        } catch (error) {
          console.error("Failed to build catalog sitemap:", error);
          sitemapXml = buildStaticSitemapXml(origin);
        }

        return new Response(sitemapXml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
