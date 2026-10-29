import { afterEach, describe, expect, it, vi } from "vitest";
import * as sitemap from "@/lib/sitemap";
import { Route as RobotsRoute } from "../robots[.]txt";
import { Route as SitemapRoute } from "../sitemap[.]xml";

vi.mock("@/env/server", () => ({ env: { WEBAPP_PUBLIC_ORIGIN: "https://hifld.publicenvirodata.org" } }));
vi.mock("@/lib/catalog-runtime", () => ({ activeCatalogLifecycle: async () => null }));

describe("crawler discovery behind the HTTPS load balancer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("advertises the public HTTPS sitemap even when the upstream request uses HTTP", async () => {
    const handler = RobotsRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing robots handler");
    const response = await handler({ request: new Request("http://webapp.internal/robots.txt"), params: {} });
    expect(await response.text()).toContain("Sitemap: https://hifld.publicenvirodata.org/sitemap.xml");
  });

  it("uses public HTTPS URLs in the fallback sitemap", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = SitemapRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing sitemap handler");
    const response = await handler({ request: new Request("http://webapp.internal/sitemap.xml"), params: {} });
    const xml = await response.text();
    expect(xml).toContain("<loc>https://hifld.publicenvirodata.org/</loc>");
    expect(xml).not.toContain("<loc>http://");
  });

  it("passes the public origin to catalog sitemap generation", async () => {
    const build = vi.spyOn(sitemap, "buildCatalogSitemapXml").mockResolvedValue("<urlset />");
    const handler = SitemapRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing sitemap handler");
    const response = await handler({ request: new Request("http://webapp.internal/sitemap.xml"), params: {} });
    expect(build).toHaveBeenCalledWith("https://hifld.publicenvirodata.org");
    expect(await response.text()).toBe("<urlset />");
  });
});
