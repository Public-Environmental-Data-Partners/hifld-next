import { expect, it } from "vitest";
import { safeErrorAdapter } from "../safe-error-serialization";

it("discards exception messages, stacks, causes and custom fields before hydration", () => {
  const error = Object.assign(new Error("private SQL and /srv/secret-file", {cause: new Error("private token")}), {request: "private body"});
  expect(safeErrorAdapter.test(error)).toBe(true);
  const serialized = safeErrorAdapter.toSerializable(error);
  expect(JSON.stringify(serialized)).not.toMatch(/private|SQL|srv|secret|token|body|stack|cause/);
  const restored = safeErrorAdapter.fromSerializable(serialized);
  expect(restored).toBeInstanceOf(Error);
  expect(restored.message).toBe("This page could not load.");
});

it("registers safe error serialization for Start hydration and server functions", async () => {
  const {startInstance} = await import("../../start");
  const options = await startInstance.getOptions();
  expect(options.serializationAdapters).toContain(safeErrorAdapter);
});
