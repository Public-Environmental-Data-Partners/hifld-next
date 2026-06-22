import { createFileRoute } from "@tanstack/react-router";
import { buildCatalogSitemapXml, buildStaticSitemapXml } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
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
