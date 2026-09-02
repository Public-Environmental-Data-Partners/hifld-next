import type { WebMcpJsonValue } from "./result";
import type { WebMcpInput } from "./schemas";

type FakeTool = WebMCP.ModelContextTool & { registrationCount: number };

export interface ModelContextExecuteOptions {
  signal?: AbortSignal;
}

export interface ModelContextFake extends WebMCP.ModelContext {
  execute(name: string, input: WebMcpInput, options?: ModelContextExecuteOptions): Promise<WebMcpJsonValue>;
  getTool(name: string): WebMCP.ModelContextTool;
  registrationCount(name: string): number;
  toolNames(): string[];
}

export function createModelContextFake(): ModelContextFake {
  const target = new EventTarget();
  const tools = new Map<string, FakeTool>();
  const registrationCounts = new Map<string, number>();
  const fake = Object.assign(target, {
    registerTool: async (
      tool: WebMCP.ModelContextTool,
      options?: WebMCP.ModelContextRegisterToolOptions,
    ): Promise<void> => {
      const nextCount = (registrationCounts.get(tool.name) ?? 0) + 1;
      registrationCounts.set(tool.name, nextCount);
      const next: FakeTool = { ...tool, registrationCount: nextCount };
      tools.set(tool.name, next);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    },
    getTools: async (): Promise<WebMCP.RegisteredTool[]> =>
      [...tools.values()].map((tool) => ({
        name: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description,
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        execute: tool.execute,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        window,
        origin: window.location.origin,
      })),
    ontoolchange: null,
    execute: async (
      name: string,
      input: WebMcpInput,
      options?: ModelContextExecuteOptions,
    ): Promise<WebMcpJsonValue> => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      return (await tool.execute(input, {
        signal: options?.signal ?? new AbortController().signal,
      })) as WebMcpJsonValue;
    },
    getTool: (name: string): WebMCP.ModelContextTool => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      return tool;
    },
    registrationCount: (name: string): number => registrationCounts.get(name) ?? 0,
    toolNames: () => [...tools.keys()],
  });
  return fake as ModelContextFake;
}

export function installModelContextFake(fake: ModelContextFake): void {
  Object.defineProperty(document, "modelContext", { configurable: true, value: fake });
}

export function installNavigatorModelContextFake(fake: ModelContextFake): void {
  Object.defineProperty(navigator, "modelContext", { configurable: true, value: fake });
}
