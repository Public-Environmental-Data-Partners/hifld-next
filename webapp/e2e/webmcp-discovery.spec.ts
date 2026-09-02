import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

const catalogTools = [
  "list_collections",
  "get_collection",
  "search_datasets",
  "get_dataset",
  "get_dataset_file",
  "get_dataset_file_schema",
] as const;

interface ModelContextTool {
  name: string;
}

interface RegistrationOptions {
  signal?: AbortSignal;
}

interface WebMcpProbe {
  registered: string[];
  cleaned: string[];
}

declare global {
  interface Window {
    __webMcpProbe?: WebMcpProbe;
    __recordWebMcpCleanup?: (toolName: string) => Promise<void>;
  }
}

const mcpServerCardSchema = z
  .object({
    $schema: z.literal("https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"),
    name: z.string().regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/),
    version: z.string(),
    description: z.string().min(1),
    title: z.string().min(1).optional(),
    remotes: z.array(z.object({ type: z.literal("streamable-http"), url: z.string().url() }).strict()).min(1),
  })
  .strict();
const agentResourceDiscoverySchema = z
  .object({
    specVersion: z.string(),
    host: z.object({ displayName: z.string(), identifier: z.string() }).strict(),
    entries: z.array(
      z
        .object({
          identifier: z.string(),
          displayName: z.string(),
          type: z.string(),
          url: z.string().url(),
          representativeQueries: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();
const unavailableSchema = z
  .object({ code: z.literal("mcp_unavailable"), message: z.literal("The MCP service is unavailable.") })
  .strict();

async function installModelContextProbe(page: Page, cleaned: string[]): Promise<void> {
  await page.exposeFunction("__recordWebMcpCleanup", (toolName: string): void => {
    cleaned.push(toolName);
  });
  await page.addInitScript(() => {
    const probe: WebMcpProbe = { registered: [], cleaned: [] };
    const modelContext = {
      registerTool(tool: ModelContextTool, options?: RegistrationOptions): Promise<void> {
        probe.registered.push(tool.name);
        options?.signal?.addEventListener(
          "abort",
          () => {
            probe.cleaned.push(tool.name);
            void window.__recordWebMcpCleanup?.(tool.name);
          },
          { once: true },
        );
        return Promise.resolve();
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    window.__webMcpProbe = probe;
  });
}

async function installNavigatorModelContextProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: WebMcpProbe = { registered: [], cleaned: [] };
    const modelContext = {
      registerTool(tool: ModelContextTool, options?: RegistrationOptions): Promise<void> {
        probe.registered.push(tool.name);
        options?.signal?.addEventListener(
          "abort",
          () => {
            probe.cleaned.push(tool.name);
          },
          { once: true },
        );
        return Promise.resolve();
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "modelContext", { configurable: true, value: modelContext });
    window.__webMcpProbe = probe;
  });
}

test("registers and cleans up the global catalog WebMCP tools", async ({ page }) => {
  const cleaned: string[] = [];
  await installModelContextProbe(page, cleaned);

  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__webMcpProbe?.registered.sort() ?? []))
    .toEqual([...catalogTools].sort());

  await page.goto("about:blank");
  await expect.poll(() => [...cleaned].sort()).toEqual([...catalogTools].sort());
});

test("uses the navigator WebMCP preview when document.modelContext is unavailable", async ({ page }) => {
  await installNavigatorModelContextProbe(page);

  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__webMcpProbe?.registered.sort() ?? []))
    .toEqual([...catalogTools].sort());
});

test("publishes a same-origin Streamable HTTP MCP server card", async ({ request }) => {
  const response = await request.get("/.well-known/mcp/server-card.json");

  expect(response.status()).toBe(200);
  const card = mcpServerCardSchema.parse(await response.json());
  expect(card).toMatchObject({
    name: "org.publicenvirodata.hifld/dataset-mcp",
    title: "HIFLD Next Dataset MCP",
    remotes: [{ type: "streamable-http", url: "http://127.0.0.1:4173/mcp" }],
  });
});

test("publishes a CORS-enabled Agent Resource Discovery document", async ({ request }) => {
  const response = await request.get("/.well-known/ai-catalog.json");

  expect(response.status()).toBe(200);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  const discovery = agentResourceDiscoverySchema.parse(await response.json());
  expect(discovery.specVersion).toBe("1.0");
  expect(discovery.host.identifier).toMatch(/^did:web:[a-z0-9.-]+$/);
  expect(discovery.entries).toHaveLength(2);
  for (const entry of discovery.entries) {
    expect(entry.identifier).toMatch(/^urn:air:[a-z0-9.-]+:[a-z-]+:[a-z-]+$/);
    expect(entry.type).toMatch(/^application\//);
    expect(entry.representativeQueries.length).toBeGreaterThan(0);
  }
});

test("returns a sanitized unavailable response when the MCP upstream is absent", async ({ request }) => {
  const response = await request.post("/mcp", {
    headers: { "MCP-Protocol-Version": "2025-06-18" },
    data: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
  });

  expect(response.status()).toBe(503);
  expect(unavailableSchema.parse(await response.json())).toEqual({
    code: "mcp_unavailable",
    message: "The MCP service is unavailable.",
  });
  expect(await response.text()).not.toContain("127.0.0.1:8000");
});
