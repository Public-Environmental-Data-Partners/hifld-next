import { Button } from "@/components/ui/button";
import type { MapDataPanelMode } from "./mapDataPanelState";

export function MapDataPanelModeControls({
  mode,
  onModeChange,
}: {
  mode: MapDataPanelMode;
  onModeChange: (mode: MapDataPanelMode) => void;
}) {
  return (
    <fieldset className="flex min-w-0 rounded-md border p-0.5">
      <legend className="sr-only">Data table view</legend>
      <Button
        type="button"
        variant={mode === "query" ? "secondary" : "ghost"}
        size="sm"
        className="min-h-8"
        aria-pressed={mode === "query"}
        onClick={() => onModeChange("query")}
      >
        Query results
      </Button>
      <Button
        type="button"
        variant={mode === "selected" ? "secondary" : "ghost"}
        size="sm"
        className="min-h-8"
        aria-pressed={mode === "selected"}
        onClick={() => onModeChange("selected")}
      >
        Selected features
      </Button>
    </fieldset>
  );
}
