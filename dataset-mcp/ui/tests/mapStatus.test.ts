import { describe, expect, it, vi } from "vitest";
import { publishMapStatus } from "../src/mcp/mapStatus";

describe("map runtime feedback", () => {
  const snapshot = {
    map_title: "Miami",
    status: "loading" as const,
    layers: [{ layer_name: "Hospitals", status: "loading" as const }],
  };
  it("sends structured status and text only when supported", async () => {
    const app = {
      getHostCapabilities: () => ({
        updateModelContext: { structuredContent: {} },
      }),
      updateModelContext: vi.fn().mockResolvedValue({}),
    };
    expect(await publishMapStatus(app, snapshot)).toBe("updated");
    expect(app.updateModelContext).toHaveBeenCalledWith({
      structuredContent: { map_status: snapshot },
    });
  });
  it("reports unsupported and rejected delivery without throwing", async () => {
    expect(await publishMapStatus(null, snapshot)).toBe("unsupported");
    const app = {
      getHostCapabilities: () => ({ updateModelContext: { text: {} } }),
      updateModelContext: vi
        .fn()
        .mockRejectedValue(new Error("host disconnected")),
    };
    expect(await publishMapStatus(app, snapshot)).toBe("rejected");
  });
});
