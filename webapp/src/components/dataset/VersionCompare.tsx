import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ColumnSchema, DatasetSource, SpatialDatasetFileMetadata } from "@/lib/api-client";

type MetadataKey =
  | "feature_count"
  | "bounds"
  | "geometry_type"
  | "size_bytes"
  | "quality_check_passed"
  | "invalid_geometry_count"
  | "columns_hash";

const METADATA_KEYS: MetadataKey[] = [
  "feature_count",
  "bounds",
  "geometry_type",
  "size_bytes",
  "quality_check_passed",
  "invalid_geometry_count",
  "columns_hash",
];

type MetadataValue = SpatialDatasetFileMetadata[MetadataKey];

function normalizeValue(value: MetadataValue): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function isDifferent(
  a: MetadataValue | ColumnSchema | undefined,
  b: MetadataValue | ColumnSchema | undefined,
): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

function getColumns(metadata?: SpatialDatasetFileMetadata): ColumnSchema[] {
  return metadata?.columns ?? [];
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || value === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function sourceLabel(source: DatasetSource, fallback: string): string {
  const version = source.version === undefined ? fallback : `Version ${source.version}`;
  const location = source.storage_location?.name;
  return location ? `${version} (${location})` : version;
}

export function VersionCompare({
  leftSource,
  rightSource,
  leftLabel,
  rightLabel,
}: {
  leftSource: DatasetSource;
  rightSource: DatasetSource;
  leftLabel?: string | undefined;
  rightLabel?: string | undefined;
}) {
  const metadataA = leftSource.source_metadata;
  const metadataB = rightSource.source_metadata;
  const columnsA = getColumns(metadataA);
  const columnsB = getColumns(metadataB);
  const versionA = leftLabel ?? sourceLabel(leftSource, "Left source");
  const versionB = rightLabel ?? sourceLabel(rightSource, "Right source");

  const columnNames = Array.from(
    new Set([...columnsA.map((column) => column.name), ...columnsB.map((column) => column.name)]),
  ).sort();

  const schemaRows = columnNames.map((name) => {
    const left = columnsA.find((column) => column.name === name);
    const right = columnsB.find((column) => column.name === name);

    let changeType: "Added" | "Removed" | "Changed" | "Unchanged" = "Unchanged";
    if (!left && right) {
      changeType = "Added";
    } else if (left && !right) {
      changeType = "Removed";
    } else if (left && right && isDifferent(left, right)) {
      changeType = "Changed";
    }

    return { name, left, right, changeType };
  });

  const changedSchemaRows = schemaRows.filter((row) => row.changeType !== "Unchanged");
  const changedMetadataCount = METADATA_KEYS.filter((key) => isDifferent(metadataA?.[key], metadataB?.[key])).length;
  const addedColumns = changedSchemaRows.filter((row) => row.changeType === "Added").length;
  const removedColumns = changedSchemaRows.filter((row) => row.changeType === "Removed").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rows</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {normalizeValue(metadataA?.feature_count)} → {normalizeValue(metadataB?.feature_count)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quality</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {normalizeValue(metadataB?.quality_check_passed)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Size</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatBytes(metadataB?.size_bytes)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Changed Fields</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {changedMetadataCount + changedSchemaRows.length}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Metadata Changes</h2>
          <p className="text-sm text-muted-foreground">
            Compare file-level metadata between the chosen left and right sources.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>{versionA}</TableHead>
              <TableHead>{versionB}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {METADATA_KEYS.map((key) => {
              const left = metadataA?.[key];
              const right = metadataB?.[key];
              const changed = isDifferent(left, right);

              return (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell className={changed ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                    {normalizeValue(left)}
                  </TableCell>
                  <TableCell className={changed ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                    {normalizeValue(right)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Schema Changes</h2>
          <p className="text-sm text-muted-foreground">
            Added and removed are relative to the right source. Schema details come from source metadata and data
            dictionaries when available.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="default">{addedColumns} added</Badge>
            <Badge variant="destructive">{removedColumns} removed</Badge>
            <Badge variant="outline">{changedSchemaRows.length - addedColumns - removedColumns} changed</Badge>
          </div>
        </div>
        {changedSchemaRows.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">No schema changes</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Column</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>{versionA}</TableHead>
                <TableHead>{versionB}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changedSchemaRows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-mono text-xs">{row.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.changeType === "Added"
                          ? "default"
                          : row.changeType === "Removed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {row.changeType}
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top">
                    {row.left ? <ColumnDetails column={row.left} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    {row.right ? (
                      <ColumnDetails column={row.right} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function ColumnDetails({ column }: { column: ColumnSchema }) {
  return (
    <div className="space-y-1 text-sm">
      <div>
        <span className="font-medium">Type:</span> {column.type}
      </div>
      <div>
        <span className="font-medium">Nullable:</span> {column.nullable ? "Yes" : "No"}
      </div>
      {column.description ? (
        <div>
          <span className="font-medium">Description:</span> {column.description}
        </div>
      ) : null}
    </div>
  );
}
