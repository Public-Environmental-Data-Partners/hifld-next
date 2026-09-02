import { z } from "zod";
import { schemaToJsonSchema } from "../schemas";

describe("schemaToJsonSchema", () => {
  it("converts a Zod input schema to draft 2020-12 JSON Schema", () => {
    const schema = z.object({ query: z.string().min(1) });
    expect(schemaToJsonSchema(schema)).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
    });
  });
});
