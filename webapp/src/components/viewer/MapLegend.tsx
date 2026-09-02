import { type MapLegendProps, MapLegend as SharedMapLegend } from "@hifld/map-ui";
import { Button } from "@/components/ui/button";

export type { MapLegendGroup as LegendGroup } from "@hifld/map-ui";

export function MapLegend(props: MapLegendProps) {
  return (
    <SharedMapLegend
      {...props}
      renderCollapsedToggle={({ ariaLabel, icon, onClick }) => (
        <div className="absolute bottom-4 left-4 z-10">
          <Button
            variant="secondary"
            size="icon"
            onClick={onClick}
            className="h-9 w-9 shadow-md"
            aria-label={ariaLabel}
          >
            {icon}
          </Button>
        </div>
      )}
      renderCloseButton={({ ariaLabel, icon, onClick }) => (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClick} aria-label={ariaLabel}>
          {icon}
        </Button>
      )}
    />
  );
}
