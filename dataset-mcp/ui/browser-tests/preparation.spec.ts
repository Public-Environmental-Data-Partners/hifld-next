import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { JsonValue } from "../src/mcp/contracts";
import type { MapStatus } from "../src/mcp/mapStatus";

// A valid PMTiles v3 archive with one uncompressed MVT at z0. All bytes are
// local, so this exercises real range reads and decoding without remote data.
function publishedArchive(): Buffer {
  const tile = Buffer.from([
    26, 12, 120, 2, 10, 5, 104, 105, 102, 108, 100, 40, 128, 32,
  ]);
  const directory = Buffer.from([1, 0, 1, tile.length, 1]);
  const metadata = Buffer.from(
    JSON.stringify({ vector_layers: [{ id: "hifld", fields: {} }] }),
  );
  const header = Buffer.alloc(127);
  header.write("PMTiles");
  header[7] = 3;
  for (const [offset, value] of [
    [8, 127],
    [16, directory.length],
    [24, 127 + directory.length],
    [32, metadata.length],
    [56, 127 + directory.length + metadata.length],
    [64, tile.length],
    [72, 1],
    [80, 1],
    [88, 1],
  ] as const)
    header.writeBigUInt64LE(BigInt(value), offset);
  for (const offset of [96, 97, 98, 99]) header[offset] = 1;
  for (const [offset, value] of [
    [102, -180],
    [106, -85],
    [110, 180],
    [114, 85],
  ] as const)
    header.writeInt32LE(value * 10000000, offset);
  return Buffer.concat([header, directory, metadata, tile]);
}

for (const finishWhileTilesLoad of [false, true]) {
  test(`PMTiles and queries load independently (query finishes while PMTiles loading: ${finishWhileTilesLoad})`, async ({
    page,
  }, testInfo) => {
    const html = await readFile(
      new URL("../dist/index.html", import.meta.url),
      "utf8",
    );
    const worker = await readFile(
      new URL("../dist/maplibre-gl-worker.cjs", import.meta.url),
    );
    let tileRequests = 0;
    let queryRequests = 0;
    let tileHeld = false;
    let releaseTiles = () => {};
    const tileGate = new Promise<void>((resolve) => {
      releaseTiles = resolve;
    });
    const archive = publishedArchive();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#eeeeee" },
            },
          ],
        }),
      }),
    );
    await page
      .context()
      .route("https://maps.example.test/**", async (route) => {
        const headers = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "X-HIFLD-Query-Token",
        };
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        if (route.request().url().includes("/assets/"))
          return route.fulfill({
            contentType: "text/javascript",
            headers,
            body: worker,
          });
        if (route.request().url().includes("/tiles/")) {
          queryRequests += 1;
          return route.fulfill({
            contentType: "application/vnd.mapbox-vector-tile",
            headers,
            body: archive.subarray(-14),
          });
        }
        tileRequests += 1;
        const range = /^bytes=(\d+)-(\d+)$/.exec(
          route.request().headers().range ?? "",
        );
        const start = Number(range?.[1] ?? 0);
        if (finishWhileTilesLoad && start === archive.length - 14) {
          tileHeld = true;
          await tileGate;
        }
        const end = Math.min(
          Number(range?.[2] ?? archive.length - 1),
          archive.length - 1,
        );
        return route.fulfill({
          status: 206,
          contentType: "application/octet-stream",
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${archive.length}`,
            "Access-Control-Expose-Headers": "Content-Range",
          },
          body: archive.subarray(start, end + 1),
        });
      });
    await page.route("http://localhost:18767/app", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.route("http://localhost:18767/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<iframe sandbox="allow-scripts" src="/app" width="950" height="800"></iframe>',
      }),
    );
    await page.addInitScript(() => {
      if (window !== window.top) return;
      window.addEventListener(
        "message",
        (
          event: MessageEvent<{
            method: string;
            id: number;
            params: {
              protocolVersion: string;
              structuredContent?: { map_status?: MapStatus };
              name?: string;
              arguments?: { layer?: { layer_name?: string } };
            };
          }>,
        ) => {
          const reply = (result: Record<string, JsonValue>) =>
            document
              .querySelector("iframe")
              ?.contentWindow?.postMessage(
                { jsonrpc: "2.0", id: event.data.id, result },
                "*",
              );
          if (event.data.method === "ui/initialize")
            reply({
              protocolVersion: event.data.params.protocolVersion,
              hostInfo: { name: "preparation-test", version: "1" },
              hostCapabilities: {
                serverTools: {},
                updateModelContext: { structuredContent: {} },
              },
              hostContext: { theme: "light", displayMode: "inline" },
            });
          else if (event.data.method === "ui/notifications/initialized")
            document.body.dataset.ready = "true";
          else if (event.data.method === "ui/update-model-context") {
            const status = event.data.params.structuredContent?.map_status;
            if (status) document.body.dataset.status = JSON.stringify(status);
            reply({});
          } else if (event.data.method === "tools/call") {
            if (event.data.params.arguments?.layer?.layer_name === "Broken")
              reply({
                content: [],
                isError: true,
                structuredContent: {
                  error: {
                    code: "query_execution_failed",
                    message: "Query failed",
                  },
                },
              });
            else document.body.dataset.pendingRequest = String(event.data.id);
          }
        },
      );
    });
    await page.goto("http://localhost:18767/");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const source = {
      type: "pmtiles",
      url: "https://maps.example.test/public/map.pmtiles",
      source_layer: "hifld",
    };
    await page.evaluate((externalSource) => {
      const queries = ["Slow", "Broken"];
      document.querySelector("iframe")?.contentWindow?.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content: [],
            structuredContent: {
              title: "Independent layers",
              basemap: "street",
              worker_url:
                "https://maps.example.test/assets/maplibre-gl-worker.cjs",
              layers: [
                {
                  layer_id: "external-0",
                  layer_name: "Published",
                  visible: true,
                  source: externalSource,
                },
                ...queries.map((layer_name, index) => ({
                  layer_id: `preparing-${index + 1}`,
                  layer_name,
                  visible: true,
                  preparation_status: "preparing",
                })),
              ],
              map_spec: {
                title: "Independent layers",
                basemap: "street",
                layers: [
                  {
                    layer_name: "Published",
                    visible: true,
                    source: externalSource,
                  },
                  ...queries.map((layer_name) => ({
                    layer_name,
                    visible: true,
                    source: {
                      type: "query",
                      inputs: [{ alias: "h", file_id: 1 }],
                      sql: "SELECT geometry FROM h",
                    },
                  })),
                ],
              },
            },
          },
        },
        "*",
      );
    }, source);
    if (finishWhileTilesLoad) await expect.poll(() => tileHeld).toBe(true);
    await expect(page.locator("body")).toHaveAttribute(
      "data-status",
      finishWhileTilesLoad
        ? /"layer_name":"Published","status":"loading"/
        : /"layer_name":"Published","status":"loaded"/,
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-status",
      /"layer_name":"Slow","status":"preparing"/,
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-status",
      /"layer_name":"Broken","status":"failed"/,
    );
    expect(tileRequests).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("preparing-and-failed.png"),
    });
    const readyRequests = tileRequests;
    await page.evaluate((nonempty) => {
      const queryId = "independentquery123456789AB";
      document.querySelector("iframe")?.contentWindow?.postMessage(
        {
          jsonrpc: "2.0",
          id: Number(document.body.dataset.pendingRequest),
          result: {
            content: [],
            structuredContent: {
              worker_url:
                "https://maps.example.test/assets/maplibre-gl-worker.cjs",
              layer: {
                layer_name: "Slow",
                query_id: queryId,
                query_token: "signed-token",
                tile_url: `https://maps.example.test/tiles/${queryId}/{z}/{x}/{y}.mvt`,
                source_layer: "hifld",
                geometry_column: "geometry",
                result_crs: "EPSG:4326",
                columns: [],
                result_status: nonempty ? "rows_returned" : "empty_result",
                visible: true,
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
            },
          },
        },
        "*",
      );
    }, finishWhileTilesLoad);
    if (finishWhileTilesLoad) {
      await expect.poll(() => queryRequests).toBeGreaterThan(0);
      await expect(page.locator("body")).toHaveAttribute(
        "data-status",
        /"layer_name":"Slow","status":"loaded"/,
      );
      releaseTiles();
      await expect(page.locator("body")).toHaveAttribute(
        "data-status",
        /"layer_name":"Published","status":"loaded"/,
      );
    }
    await expect(page.locator("body")).toHaveAttribute(
      "data-status",
      finishWhileTilesLoad
        ? /"layer_name":"Slow","status":"loaded"/
        : /"layer_name":"Slow","status":"empty_result"/,
    );
    expect(tileRequests).toBe(readyRequests);
    await page.screenshot({
      path: testInfo.outputPath("empty-and-failed.png"),
    });
    expect(errors).toEqual([]);
  });
}
