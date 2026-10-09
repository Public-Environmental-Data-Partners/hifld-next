import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogLifecycle } from "@/lib/catalog-repository";

const { activeCatalogLifecycle } = vi.hoisted(() => ({ activeCatalogLifecycle: vi.fn() }));
vi.mock("@/lib/catalog-runtime", () => ({ activeCatalogLifecycle }));
vi.mock("@/env/server", () => ({ env: {} }));

import { buildCatalogSitemapXml } from "@/lib/sitemap";

afterEach(() => vi.unstubAllGlobals());

it("walks the published catalog under one lease without contacting dataset-api", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hifld-sitemap-"));
  const path = join(directory, "catalog.sqlite");
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(process.cwd(), "../feature-server/tests/fixtures/publisher_catalog.sql"), "utf8"));
  db.exec("INSERT INTO collections VALUES ('other', 'other', 'Other', 'Other collection', 'other/catalog.json', NULL, NULL, NULL)");
  const insert = db.prepare("INSERT INTO datasets VALUES (?, ?, ?, 'Paged dataset', 'Description', ?, NULL, NULL)");
  for (let index = 0; index <= 500; index++) {
    const slug = `paged-${String(index).padStart(3, '0')}`;
    insert.run(`hifld/${slug}`, "hifld", slug, `hifld/${slug}/catalog.json`);
  }
  insert.run("other/sample", "other", "sample", "other/sample/catalog.json");
  db.close();
  const lifecycle = new CatalogLifecycle({ kind: "file", path });
  await lifecycle.start();
  activeCatalogLifecycle.mockResolvedValue(lifecycle);
  const lease = vi.spyOn(lifecycle, "withRepository");
  const fetch = vi.fn().mockRejectedValue(new Error("legacy API unavailable"));
  vi.stubGlobal("fetch", fetch);
  try {
    const xml = await buildCatalogSitemapXml("https://example.test");
    expect(xml).toContain("https://example.test/collections/hifld/datasets/sample/files/points");
    expect(xml).toContain("<lastmod>2026-09-08</lastmod>");
    expect(xml).toContain("https://example.test/collections/hifld/datasets/paged-500");
    expect(xml).toContain("https://example.test/collections/other/datasets/sample");
    expect(lease).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await lifecycle.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
