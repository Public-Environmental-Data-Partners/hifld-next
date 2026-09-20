import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chartRoot = resolve(__dirname, "../../../../charts/webapp");

describe("webapp chart catalog configuration", () => {
  it("passes the release pointer to the server-only catalog reader", () => {
    const values = readFileSync(resolve(chartRoot, "values.yaml"), "utf8");
    const deployment = readFileSync(resolve(chartRoot, "templates/deployment.yaml"), "utf8");

    expect(values).toContain('pointerUrl: ""');
    expect(deployment).toContain("name: CATALOG_RELEASE_POINTER_URL");
    expect(deployment).toContain(".Values.catalog.pointerUrl | quote");
  });
});
