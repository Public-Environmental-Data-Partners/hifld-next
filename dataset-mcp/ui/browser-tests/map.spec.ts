import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PbfWriter } from "pbf";

function pointTile(): Buffer {
  const tile = new PbfWriter();
  tile.writeMessage(
    3,
    (_, layer) => {
      layer.writeVarintField(15, 2);
      layer.writeStringField(1, "hifld");
      layer.writeVarintField(5, 4096);
      layer.writeStringField(3, "NAME");
      layer.writeStringField(3, "__hifld_feature_key");
      layer.writeMessage(
        4,
        (_, value) => value.writeStringField(1, "Test Hospital"),
        null,
      );
      layer.writeMessage(
        4,
        (_, value) => value.writeStringField(1, "hospital-1"),
        null,
      );
      layer.writeMessage(
        2,
        (_, feature) => {
          feature.writeVarintField(1, 1);
          feature.writePackedVarint(2, [0, 0, 1, 1]);
          feature.writeVarintField(3, 1);
          feature.writePackedVarint(4, [9, 4096, 4096]);
        },
        null,
      );
    },
    null,
  );
  return Buffer.from(tile.finish());
}

for (const opaqueOrigin of [false, true]) {
  test(`renders selectable MVT points in an iframe (opaque origin: ${opaqueOrigin})`, async ({
    page,
  }) => {
    const html = await readFile(
      new URL("../dist/index.html", import.meta.url),
      "utf8",
    );
    const worker = await readFile(
      new URL("../dist/maplibre-gl-worker.cjs", import.meta.url),
    );
    const tile = pointTile();
    const tileHeaders: Array<string | undefined> = [];
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
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers });
        } else if (route.request().url().includes("/assets/")) {
          await route.fulfill({
            contentType: "text/javascript",
            headers,
            body: worker,
          });
        } else {
          tileHeaders.push(route.request().headers()["x-hifld-query-token"]);
          await route.fulfill({
            contentType: "application/vnd.mapbox-vector-tile",
            headers,
            body: tile,
          });
        }
      });
    await page.route("http://localhost:18766/app", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.route("http://localhost:18766/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<iframe ${opaqueOrigin ? 'sandbox="allow-scripts"' : ""} src="/app" width="950" height="800"></iframe>`,
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
            params: { protocolVersion: string };
          }>,
        ) => {
          if (event.data.method === "ui/initialize") {
            document.querySelector("iframe")?.contentWindow?.postMessage(
              {
                jsonrpc: "2.0",
                id: event.data.id,
                result: {
                  protocolVersion: event.data.params.protocolVersion,
                  hostInfo: { name: "local-browser-test", version: "1" },
                  hostCapabilities: {},
                  hostContext: { theme: "light", displayMode: "inline" },
                },
              },
              "*",
            );
          } else if (event.data.method === "ui/notifications/initialized") {
            document.body.dataset.ready = "true";
          }
        },
      );
    });
    await page.goto("http://localhost:18766/");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const queryId = "hospitalquery123456789AB";
    await page.evaluate(
      (result) => {
        document.querySelector("iframe")?.contentWindow?.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: { content: [], structuredContent: result },
          },
          "*",
        );
      },
      {
        title: "Hospital browser test",
        basemap: "street",
        camera: {
          center: [
            -73.916015625,
            (Math.atan(Math.sinh(Math.PI * (1 - (2 * 769.5) / 2048))) * 180) /
              Math.PI,
          ],
          zoom: 11,
        },
        worker_url: "https://maps.example.test/assets/maplibre-gl-worker.cjs",
        layers: [
          {
            query_id: queryId,
            layer_name: "Hospitals",
            tile_url: `https://maps.example.test/tiles/${queryId}/{z}/{x}/{y}.mvt`,
            source_layer: "hifld",
            geometry_column: "geometry",
            result_crs: "EPSG:3857",
            columns: [
              {
                name: "geometry",
                type: "GEOMETRY('EPSG:3857')",
                nullable: false,
              },
              { name: "NAME", type: "VARCHAR", nullable: false },
            ],
            query_token: "test-query-token",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            visible: true,
            style: { color: "#d73027", point_radius: 10 },
          },
        ],
        map_spec: {
          title: "Hospital browser test",
          basemap: "street",
          layers: [
            {
              layer_name: "Hospitals",
              sources: [{ alias: "h", file_id: 4355 }],
              sql: "SELECT NAME, geometry FROM h",
              visible: true,
            },
          ],
        },
      },
    );
    const frame = page.frameLocator("iframe");
    await expect.poll(() => tileHeaders.length).toBeGreaterThan(0);
    expect(tileHeaders.every((value) => value === "test-query-token")).toBe(
      true,
    );
    // Clicking the rendered center point verifies rendering, not merely successful fetches.
    await expect(async () => {
      await frame.locator("canvas.maplibregl-canvas").click();
      await expect(
        frame.getByText("Test Hospital", { exact: true }),
      ).toBeVisible();
    }).toPass({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
}
