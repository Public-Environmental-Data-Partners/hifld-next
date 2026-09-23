import type { CategoryFieldType } from "@hifld/map-core";
import type { ColumnSchema } from "@/lib/api-client";
import type { ScalarFieldSummary } from "./types";

interface TileFieldTypes {
  [fieldName: string]: string | number | boolean | undefined;
}

export function scalarFieldType(type: string | number | boolean | undefined): CategoryFieldType | undefined {
  if (typeof type === "number") return "number";
  if (typeof type === "boolean") return "boolean";
  if (typeof type !== "string") return undefined;
  const normalized = type.toLowerCase();
  if (/^(u?int\d*|integer|number|float\d*|double|decimal|numeric|real|bigint|smallint)/.test(normalized))
    return "number";
  if (/^(bool)/.test(normalized)) return "boolean";
  if (/^(string|str|text|varchar|char|date|timestamp|utf8|large_string)/.test(normalized)) return "string";
  return undefined;
}

export function scalarFieldSummaries(
  fields: TileFieldTypes | undefined,
  columns: ColumnSchema[] | undefined,
): ScalarFieldSummary[] {
  return Object.entries(fields ?? {}).flatMap(([name, tileType]) => {
    const column = columns?.find((entry) => entry.name === name);
    const type = scalarFieldType(column?.type) ?? scalarFieldType(tileType);
    return type ? [{ name, type, values: column?.possible_values ?? [] }] : [];
  });
}
