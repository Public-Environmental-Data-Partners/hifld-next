import { Columns2, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ParquetViewerPanel } from "@/components/dataset/ParquetViewerPanel";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { HighlightedFeatureRow, LoadedTableSource } from "./multiLayerSources";

interface TablePanelManagerProps {
  sources: LoadedTableSource[];
  highlightedFeatureRows: HighlightedFeatureRow[];
  initialPrimarySourceId?: string | undefined;
  initialSecondarySourceId?: string | undefined;
}

export function getInitialTablePanelState({
  sources,
  initialPrimarySourceId,
  initialSecondarySourceId,
}: {
  sources: LoadedTableSource[];
  initialPrimarySourceId?: string | undefined;
  initialSecondarySourceId?: string | undefined;
}): {
  primarySourceId: string;
  secondarySourceId: string;
  isSplit: boolean;
} {
  return {
    primarySourceId: initialPrimarySourceId ?? sources[0]?.id ?? "highlighted",
    secondarySourceId: initialSecondarySourceId ?? sources[1]?.id ?? "highlighted",
    isSplit: Boolean(initialSecondarySourceId),
  };
}

function selectedSource(sources: LoadedTableSource[], id: string | null): LoadedTableSource | null {
  if (sources.length === 0) return null;
  return sources.find((source) => source.id === id) ?? sources[0] ?? null;
}

function HighlightedFeaturesTable({ rows }: { rows: HighlightedFeatureRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Highlight features on the map to inspect their rows here.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium text-muted-foreground">{row.layerLabel}</div>
            <div className="mt-2 grid gap-1 text-sm">
              {row.values.slice(0, 20).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[minmax(7rem,12rem)_1fr] gap-3">
                  <span className="truncate font-mono text-xs text-muted-foreground">{key}</span>
                  <span className="min-w-0 break-words">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceSelect({
  sources,
  value,
  onValueChange,
}: {
  sources: LoadedTableSource[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 min-w-48">
        <SelectValue placeholder="Select source" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="highlighted">Highlighted features</SelectItem>
        {sources.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            {source.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableSlot({
  sources,
  highlightedFeatureRows,
  sourceId,
  onSourceIdChange,
}: {
  sources: LoadedTableSource[];
  highlightedFeatureRows: HighlightedFeatureRow[];
  sourceId: string;
  onSourceIdChange: (value: string) => void;
}) {
  const source = selectedSource(sources, sourceId === "highlighted" ? null : sourceId);
  const resolvedSourceId = sourceId === "highlighted" ? "highlighted" : (source?.id ?? "highlighted");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Table2 className="h-4 w-4" />
          Data
        </div>
        <SourceSelect sources={sources} value={resolvedSourceId} onValueChange={onSourceIdChange} />
      </div>
      <Separator className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-hidden">
        {resolvedSourceId === "highlighted" ? (
          <HighlightedFeaturesTable rows={highlightedFeatureRows} />
        ) : source ? (
          <ParquetViewerPanel
            url={source.url}
            fileName={source.fileName}
            onClose={() => onSourceIdChange("highlighted")}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No table-ready source is loaded.
          </div>
        )}
      </div>
    </div>
  );
}

export function TablePanelManager({
  sources,
  highlightedFeatureRows,
  initialPrimarySourceId,
  initialSecondarySourceId,
}: TablePanelManagerProps) {
  const initialState = getInitialTablePanelState({ sources, initialPrimarySourceId, initialSecondarySourceId });
  const [primarySourceId, setPrimarySourceId] = useState(initialState.primarySourceId);
  const [secondarySourceId, setSecondarySourceId] = useState(initialState.secondarySourceId);
  const [isSplit, setIsSplit] = useState(initialState.isSplit);

  useEffect(() => {
    if (initialPrimarySourceId) {
      setPrimarySourceId(initialPrimarySourceId);
    }
  }, [initialPrimarySourceId]);

  useEffect(() => {
    if (initialSecondarySourceId) {
      setSecondarySourceId(initialSecondarySourceId);
      setIsSplit(true);
    }
  }, [initialSecondarySourceId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div>
          <div className="text-sm font-semibold">Table viewer</div>
          <div className="text-xs text-muted-foreground">Inspect a loaded source or map highlights.</div>
        </div>
        <Button size="sm" variant={isSplit ? "secondary" : "outline"} onClick={() => setIsSplit((value) => !value)}>
          <Columns2 className="mr-2 h-4 w-4" />
          Split table
        </Button>
      </div>

      {isSplit ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="50%" minSize="25%" className="min-w-0 overflow-hidden">
            <TableSlot
              sources={sources}
              highlightedFeatureRows={highlightedFeatureRows}
              sourceId={primarySourceId}
              onSourceIdChange={setPrimarySourceId}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%" minSize="25%" className="min-w-0 overflow-hidden">
            <TableSlot
              sources={sources}
              highlightedFeatureRows={highlightedFeatureRows}
              sourceId={secondarySourceId}
              onSourceIdChange={setSecondarySourceId}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <TableSlot
          sources={sources}
          highlightedFeatureRows={highlightedFeatureRows}
          sourceId={primarySourceId}
          onSourceIdChange={setPrimarySourceId}
        />
      )}
    </div>
  );
}
