import { MarkdownDescription } from "@/components/dataset/MarkdownDescription";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ColumnSchema, DatasetSource, SpatialDatasetFileMetadata } from "@/lib/api-client";

type MetadataKey =
  | "description"
  | "feature_count"
  | "bounds"
  | "geometry_type"
  | "size_bytes"
  | "quality_check_passed"
  | "invalid_geometry_count"
  | "columns_hash";

const METADATA_KEYS: MetadataKey[] = [
  "description",
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

function MetadataCellValue({ field, value }: { field: MetadataKey; value: MetadataValue }) {
  if (field === "description") {
    if (typeof value === "string" && value.trim()) {
      return <MarkdownDescription markdown={value} className="text-sm" />;
    }

    return "—";
  }

  return normalizeValue(value);
}

function isDifferent(
  a: MetadataValue | ColumnSchema | undefined,
  b: MetadataValue | ColumnSchema | undefined,
): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

function isColumnSchemaDifferent(left: ColumnSchema | undefined, right: ColumnSchema | undefined): boolean {
  if (!left || !right) {
    return left !== right;
  }

  return left.type !== right.type;
}

function getColumns(metadata?: SpatialDatasetFileMetadata): ColumnSchema[] {
  return metadata?.columns ?? [];
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
    } else if (left && right && isColumnSchemaDifferent(left, right)) {
      changeType = "Changed";
    }

    return { name, left, right, changeType };
  });

  const changedSchemaRows = schemaRows.filter((row) => row.changeType !== "Unchanged");
  const addedColumns = changedSchemaRows.filter((row) => row.changeType === "Added").length;
  const removedColumns = changedSchemaRows.filter((row) => row.changeType === "Removed").length;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Metadata Changes</h2>
          <p className="text-sm text-muted-foreground">Compare file-level metadata between the chosen versions.</p>
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
                    <MetadataCellValue field={key} value={left} />
                  </TableCell>
                  <TableCell className={changed ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                    <MetadataCellValue field={key} value={right} />
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
      {column.possible_values?.length ? (
        <div>
          <span className="font-medium">Values:</span> {column.possible_values.join(", ")}
        </div>
      ) : null}
    </div>
  );
}
