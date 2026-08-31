import { z } from "zod";

export type WebMcpInputValue = string | number | boolean | null | WebMcpInputValue[] | WebMcpInput;
export interface WebMcpInput {
  [key: string]: WebMcpInputValue;
}

interface WebMcpJsonSchemaProperties {
  [key: string]: WebMcpJsonSchema;
}

export type WebMcpJsonSchema = {
  $schema?: string;
  type?: string;
  properties?: WebMcpJsonSchemaProperties;
  required?: string[];
  items?: WebMcpJsonSchema;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | string[]
    | WebMcpJsonSchema
    | WebMcpJsonSchemaProperties
    | undefined;
};

export function schemaToJsonSchema<T extends z.ZodType>(schema: T): WebMcpJsonSchema {
  return z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as WebMcpJsonSchema;
}
