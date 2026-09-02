import type { SelectedFeaturesSortControl } from "@hifld/map-ui";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MapDataTableColumnHeader({
  column,
  label = column,
  control,
}: {
  column: string;
  label?: string | undefined;
  control: SelectedFeaturesSortControl;
}) {
  const isActive = control.sort?.column === column;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 max-w-full gap-1 px-1 text-xs"
      aria-label={control.ariaLabel}
      onClick={control.onSort}
    >
      <span className="truncate">{label}</span>
      {!isActive ? (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
      ) : control.sort?.direction === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
