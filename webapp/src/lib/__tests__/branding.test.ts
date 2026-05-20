import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(__dirname, "../../..");

function readAppFile(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

describe("PEDP branding", () => {
  it("uses the PEDP type system and full color palette", () => {
    const styles = readAppFile("src/styles.css");
    const packageJson = JSON.parse(readAppFile("package.json"));

    expect(packageJson.dependencies).toHaveProperty("@fontsource-variable/figtree");
    expect(styles).toContain('@import "@fontsource-variable/figtree"');
    expect(styles).toContain('--font-sans: "Figtree Variable", "Figtree"');
    expect(styles).toContain("--background: #F4F1EC");
    expect(styles).toContain("--foreground: #42413D");
    expect(styles).toContain("--card: #FFFFF8");
    expect(styles).toContain("--secondary: #EBE4DB");
    expect(styles).toContain("--border: #D4CBBF");
    expect(styles).toContain("--muted-foreground: #6D6659");
    expect(styles).toContain("--accent: #C0E6AA");
    expect(styles).toContain("--primary: #42413D");
    expect(styles).toContain("--chart-1: #C5E8FF");
  });

  it("uses PEDP colors for installed app chrome", () => {
    const manifest = JSON.parse(readAppFile("public/manifest.json"));

    expect(manifest.theme_color).toBe("#42413D");
    expect(manifest.background_color).toBe("#F4F1EC");
  });

  it("uses PEDP accent colors for default map styling", () => {
    const mapInitialization = readAppFile("src/components/viewer/useMapInitialization.ts");
    const viewerUtils = readAppFile("src/components/viewer/utils.ts");

    expect(mapInitialization).toContain('"fill-color": "#C5E8FF"');
    expect(mapInitialization).toContain('"line-color": "#6D6659"');
    expect(mapInitialization).toContain('"circle-color": "#C0E6AA"');
    expect(viewerUtils).toContain('colors[0] || "#C5E8FF"');
  });
});
