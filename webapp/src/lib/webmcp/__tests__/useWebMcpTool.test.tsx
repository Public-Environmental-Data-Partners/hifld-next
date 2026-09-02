import { render, waitFor } from "@testing-library/react";
import { z } from "zod";
import { createModelContextFake, installModelContextFake, installNavigatorModelContextFake } from "../modelContextFake";
import { useWebMcpTool } from "../useWebMcpTool";

const { trackWebMcpToolStarted, trackWebMcpToolCompleted, trackWebMcpToolFailed } = vi.hoisted(() => ({
  trackWebMcpToolStarted: vi.fn(),
  trackWebMcpToolCompleted: vi.fn(),
  trackWebMcpToolFailed: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackWebMcpToolStarted,
  trackWebMcpToolCompleted,
  trackWebMcpToolFailed,
}));

const inputSchema = z.object({ id: z.string().min(1) });

function Harness({ execute, enabled = true }: { execute: (input: { id: string }, signal: AbortSignal) => Promise<{ ok: true; summary: string; data: { id: string } }>; enabled?: boolean }) {
  useWebMcpTool({
    name: "get_dataset",
    title: "Get dataset",
    description: "Get one dataset.",
    schema: inputSchema,
    execute,
    enabled,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  });
  return null;
}

describe("useWebMcpTool", () => {
  it("registers after hydration, uses the latest callback, validates input, forwards annotations, and cleans up", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const firstExecute = vi.fn(async () => ({ ok: true as const, summary: "first", data: { id: "first" } }));
    const secondExecute = vi.fn(async (input: { id: string }, signal: AbortSignal) => ({
      ok: true as const,
      summary: signal.aborted ? "aborted" : "second",
      data: { id: input.id },
    }));
    const { rerender, unmount } = render(<Harness execute={firstExecute} />);
    await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));
    expect(fake.getTool("get_dataset").annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    rerender(<Harness execute={secondExecute} />);
    expect(fake.registrationCount("get_dataset")).toBe(1);
    await expect(fake.execute("get_dataset", { id: "roads" })).resolves.toMatchObject({ data: { id: "roads" } });
    expect(secondExecute).toHaveBeenCalledOnce();
    await expect(fake.execute("get_dataset", { id: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(secondExecute).toHaveBeenCalledOnce();
    unmount();
    expect(fake.toolNames()).toEqual([]);
  });

  it("does not register when disabled or unsupported", async () => {
    const disabledFake = createModelContextFake();
    installModelContextFake(disabledFake);
    render(<Harness execute={vi.fn()} enabled={false} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disabledFake.toolNames()).toEqual([]);

    const unsupportedFake = createModelContextFake();
    installModelContextFake(unsupportedFake);
    delete (document as { modelContext?: WebMCP.ModelContext }).modelContext;
    render(<Harness execute={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unsupportedFake.toolNames()).toEqual([]);
  });

  it("prefers document.modelContext and falls back to navigator.modelContext", async () => {
    const documentFake = createModelContextFake();
    const navigatorFake = createModelContextFake();
    installModelContextFake(documentFake);
    installNavigatorModelContextFake(navigatorFake);
    render(<Harness execute={vi.fn()} />);
    await waitFor(() => expect(documentFake.toolNames()).toEqual(["get_dataset"]));
    expect(navigatorFake.toolNames()).toEqual([]);

    const fallbackFake = createModelContextFake();
    delete (document as { modelContext?: WebMCP.ModelContext }).modelContext;
    installNavigatorModelContextFake(fallbackFake);
    render(<Harness execute={vi.fn()} />);
    await waitFor(() => expect(fallbackFake.toolNames()).toEqual(["get_dataset"]));
  });

  it("passes the model context execution signal to the callback", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const execute = vi.fn(async (_input: { id: string }, signal: AbortSignal) => ({
      ok: true as const,
      summary: "signal",
      data: { id: String(signal.aborted) },
    }));
    render(<Harness execute={execute} />);
    await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));
    const controller = new AbortController();
    await expect(fake.execute("get_dataset", { id: "roads" }, { signal: controller.signal })).resolves.toMatchObject({
      data: { id: "false" },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("records bounded lifecycle analytics around successful and failed callback execution", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, summary: "success", data: { id: "roads" } })
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: "invalid_request" as const, message: "not captured", retryable: false },
      })
      .mockRejectedValueOnce(new Error("private stack text"));
    render(<Harness execute={execute} />);
    await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));

    trackWebMcpToolStarted.mockClear();
    trackWebMcpToolCompleted.mockClear();
    trackWebMcpToolFailed.mockClear();
    await fake.execute("get_dataset", { id: "roads" });
    await fake.execute("get_dataset", { id: "roads" });
    await fake.execute("get_dataset", { id: "roads" });

    expect(trackWebMcpToolStarted).toHaveBeenNthCalledWith(1, "get_dataset", "unknown");
    expect(trackWebMcpToolCompleted).toHaveBeenCalledWith("get_dataset", "unknown", expect.any(Number));
    expect(trackWebMcpToolFailed).toHaveBeenCalledWith(
      "get_dataset",
      "unknown",
      expect.any(Number),
      "invalid_request",
    );
    expect(trackWebMcpToolFailed).toHaveBeenCalledWith(
      "get_dataset",
      "unknown",
      expect.any(Number),
      "internal_error",
    );
  });

  it("records invalid input as a failed request without invoking the callback", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const execute = vi.fn(async (_input: { id: string }, _signal: AbortSignal) => ({
      ok: true as const,
      summary: "success",
      data: { id: "roads" },
    }));
    render(<Harness execute={execute} />);
    await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));
    trackWebMcpToolStarted.mockClear();
    trackWebMcpToolFailed.mockClear();

    await expect(fake.execute("get_dataset", { id: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(trackWebMcpToolStarted).toHaveBeenCalledWith("get_dataset", "unknown");
    expect(trackWebMcpToolFailed).toHaveBeenCalledWith(
      "get_dataset",
      "unknown",
      expect.any(Number),
      "invalid_request",
    );
  });

  it("rethrows callback AbortError and an already-aborted signal without internal failure telemetry", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const execute = vi.fn(async (_input: { id: string }, _signal: AbortSignal) => {
      throw new DOMException("cancelled", "AbortError");
    });
    render(<Harness execute={execute} />);
    await waitFor(() => expect(fake.toolNames()).toEqual(["get_dataset"]));
    trackWebMcpToolStarted.mockClear();
    trackWebMcpToolFailed.mockClear();

    await expect(fake.execute("get_dataset", { id: "roads" })).rejects.toMatchObject({ name: "AbortError" });
    expect(trackWebMcpToolFailed).not.toHaveBeenCalled();

    const aborted = new AbortController();
    const reason = new Error("native cancellation reason");
    aborted.abort(reason);
    await expect(fake.execute("get_dataset", { id: "roads" }, { signal: aborted.signal })).rejects.toBe(reason);
    expect(execute).toHaveBeenCalledOnce();
    expect(trackWebMcpToolFailed).not.toHaveBeenCalled();
  });

  it("handles a rejected registration promise without an unhandled rejection or error details", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.spyOn(fake, "registerTool").mockRejectedValue(new Error("private URL and stack"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<Harness execute={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).toHaveBeenCalledWith("WebMCP tool registration failed.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private URL and stack");
    consoleError.mockRestore();

    const abortFake = createModelContextFake();
    installModelContextFake(abortFake);
    vi.spyOn(abortFake, "registerTool").mockRejectedValue(new DOMException("teardown", "AbortError"));
    const abortConsoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Harness execute={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(abortConsoleError).not.toHaveBeenCalled();
    abortConsoleError.mockRestore();
  });
});
