import HighTable, { type DataFrame } from "hightable";
import { useEffect, useState } from "react";
import "hightable/src/HighTable.css";
import { byteLengthFromUrl, parquetMetadataAsync } from "hyparquet";
import { asyncBufferFrom, parquetDataFrame } from "hyperparam";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface ParquetViewerPanelProps {
  url: string;
  fileName: string;
  onClose: () => void;
}

function limitColumns(df: DataFrame, maxColumns = 30): DataFrame {
  const filteredDescriptors = df.columnDescriptors.filter((descriptor) => {
    const name = descriptor.name.toLowerCase();
    return (
      name !== "geometry" &&
      name !== "geom" &&
      name !== "the_geom" &&
      !name.endsWith("_geom") &&
      !name.endsWith("_geometry")
    );
  });

  return {
    ...df,
    // Geometry payloads are often very large and expensive to stringify in table cells.
    columnDescriptors: (filteredDescriptors.length > 0 ? filteredDescriptors : df.columnDescriptors).slice(
      0,
      maxColumns,
    ),
  };
}

async function loadParquetDataFrame(url: string): Promise<{ dataFrame: DataFrame; totalRows: number }> {
  const byteLength = await byteLengthFromUrl(url);
  const asyncBuffer = await asyncBufferFrom({ url, byteLength });
  const metadata = await parquetMetadataAsync(asyncBuffer);
  const baseDf = parquetDataFrame({ url, byteLength }, metadata, {
    utf8: false,
  });

  return {
    dataFrame: limitColumns(baseDf, 30),
    totalRows: baseDf.numRows,
  };
}

function renderErrorMessage(error: Error): string {
  return error.message || error.toString() || "Failed to render parquet table.";
}

function renderTableErrorMessage(error: Error | null | undefined): string {
  if (error) {
    return renderErrorMessage(error);
  }
  return "Failed to render parquet table.";
}

export function ParquetViewerPanel({ url, fileName, onClose }: ParquetViewerPanelProps) {
  const [tableInstanceId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [dataFrame, setDataFrame] = useState<DataFrame | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(null);
    setDataFrame(null);
    setTotalRows(null);

    loadParquetDataFrame(url)
      .then((result) => {
        if (!isActive) return;
        setDataFrame(result.dataFrame);
        setTotalRows(result.totalRows);
      })
      .catch((err) => {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : "Failed to load parquet file.");
      })
      .finally(() => {
        if (!isActive) return;
        setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [url]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">Parquet Preview</p>
          <p className="text-xs text-muted-foreground truncate">{fileName}</p>
        </div>
        <div className="flex items-center gap-2">
          {totalRows !== null && (
            <span className="text-xs text-muted-foreground">{totalRows.toLocaleString()} rows (lazy-loaded)</span>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <Separator className="shrink-0" />
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading parquet metadata...
          </div>
        )}
        {!isLoading && error && (
          <div className="flex h-full items-center justify-center text-sm text-destructive p-4">{error}</div>
        )}
        {!isLoading && !error && dataFrame && (
          <HighTable
            key={tableInstanceId}
            cacheKey={`${url}:${tableInstanceId}`}
            data={dataFrame}
            className="h-full hightable"
            onError={(err) => {
              setError(renderTableErrorMessage(err instanceof Error ? err : null));
            }}
          />
        )}
        {!isLoading && !error && !dataFrame && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No data available for preview.
          </div>
        )}
      </div>
    </div>
  );
}
