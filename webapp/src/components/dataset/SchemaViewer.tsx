import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ColumnSchema } from "@/lib/api-client";
import { getSchemaSummary, type SchemaSourceSelection } from "./schemaSources";
import { formatVersionLabel } from "./versionLabel";

interface SchemaViewerProps {
  fileName: string;
  selectedVersion: string | number;
  versionOptions: Array<string | number>;
  selectedSchemaSource: SchemaSourceSelection | null;
  rawMetadataHref: string;
  onVersionChange: (version: string) => void;
}

function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString();
}

function formatValues(values: string[] | undefined): string {
  return values?.length ? values.join(", ") : "—";
}

function formatRange(column: ColumnSchema): string {
  if (column.min == null && column.max == null) return "—";
  if (column.min != null && column.max != null) return `${column.min} to ${column.max}`;
  if (column.min != null) return `>= ${column.min}`;
  return `<= ${column.max}`;
}

function columnMatchesSearch(column: ColumnSchema, search: string): boolean {
  if (!search.trim()) return true;
  const needle = search.toLowerCase();
  return [column.name, column.type, column.description ?? ""].some((value) => value.toLowerCase().includes(needle));
}

export function SchemaViewer({
  fileName,
  selectedVersion,
  versionOptions,
  selectedSchemaSource,
  rawMetadataHref,
  onVersionChange,
}: SchemaViewerProps) {
  const [search, setSearch] = useState("");

  const metadata = selectedSchemaSource?.source.source_metadata;
  const columns = metadata?.columns ?? [];
  const summary = getSchemaSummary(metadata);
  const filteredColumns = columns.filter((column) => columnMatchesSearch(column, search));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-mono text-3xl font-bold tracking-tight">Schema</h1>
        <p className="text-muted-foreground">
          {fileName} / {formatVersionLabel(selectedVersion)}
        </p>
        {selectedSchemaSource ? (
          <p className="text-sm text-muted-foreground">
            Schema from {selectedSchemaSource.formatName},{" "}
            {selectedSchemaSource.source.storage_location?.name ?? "unknown location"},{" "}
            {formatVersionLabel(selectedSchemaSource.source.version)}.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryItem label="Columns" value={`${summary.columnCount} columns`} />
        <SummaryItem label="Features" value={formatCount(summary.featureCount)} />
        <SummaryItem label="Geometry" value={summary.geometryType ?? "—"} />
      </div>

      <div className="flex flex-col gap-3 border-y py-4 lg:flex-row lg:items-end">
        <div className="min-w-40 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="schema-version">
            Version
          </label>
          <select
            id="schema-version"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={String(selectedVersion)}
            onChange={(event) => onVersionChange(event.target.value)}
          >
            {versionOptions.map((version) => (
              <option key={String(version)} value={String(version)}>
                {formatVersionLabel(version)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="schema-search">
            Search columns
          </label>
          <Input
            id="schema-search"
            type="search"
            role="searchbox"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Column name, type, or description"
          />
        </div>
      </div>

      {!selectedSchemaSource ? (
        <div className="border p-6">
          <h2 className="font-medium">No data dictionary found for this version.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Raw file metadata may still contain source details for this dataset file.
          </p>
          <a className="mt-4 inline-flex text-sm underline underline-offset-4" href={rawMetadataHref}>
            View raw metadata
          </a>
        </div>
      ) : filteredColumns.length === 0 ? (
        <div className="border p-6 text-sm text-muted-foreground">No columns match the current filters.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Nullable</TableHead>
              <TableHead>Nulls</TableHead>
              <TableHead>Unique</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Examples / Values</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredColumns.map((column) => (
              <TableRow key={column.name}>
                <TableCell className="align-top font-mono text-xs">{column.name}</TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline">{column.type}</Badge>
                </TableCell>
                <TableCell className="align-top">{column.nullable ? "Yes" : "No"}</TableCell>
                <TableCell className="align-top">{formatCount(column.num_null_values ?? null)}</TableCell>
                <TableCell className="align-top">{formatCount(column.num_unique_values ?? null)}</TableCell>
                <TableCell className="max-w-md align-top text-sm">
                  {column.description || <span className="text-muted-foreground">—</span>}
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <span>Range: {formatRange(column)}</span>
                    <span>Length: {column.length ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-sm align-top text-sm">
                  <div>
                    <span className="font-medium">Examples:</span> {formatValues(column.example_values)}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium">Values:</span> {formatValues(column.possible_values)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selectedSchemaSource ? (
        <div className="grid gap-2 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-2">
          <div>Invalid geometry count: {formatCount(summary.invalidGeometryCount)}</div>
          <div>Columns hash: {summary.columnsHash ?? "—"}</div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}
