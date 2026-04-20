import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type maplibregl from "maplibre-gl";

interface MapControlsProps {
  mapRef: React.RefObject<maplibregl.Map | null>;
}

export function MapControls({ mapRef }: MapControlsProps) {
  return (
    <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
      <Button
        variant="secondary"
        size="icon"
        onClick={() => mapRef.current?.zoomIn()}
        className="h-9 w-9 shadow-md"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => mapRef.current?.zoomOut()}
        className="h-9 w-9 shadow-md"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

