import {
  type MapLegendGroup,
  MapLegend as SharedMapLegend,
} from "@hifld/map-ui";
import type { LegendItem } from "./mapStyle";

interface LegendGroup extends MapLegendGroup {
  field: string | null;
  items: LegendItem[];
  layerVisible: boolean;
}

interface MapLegendProps {
  groups: LegendGroup[];
  visible: boolean;
  onToggle: () => void;
  onLayerVisibilityChange: (id: string, visible: boolean) => void;
}

export function MapLegend({
  groups,
  visible,
  onToggle,
  onLayerVisibilityChange,
}: MapLegendProps) {
  return (
    <SharedMapLegend
      className="map-legend"
      toggleClassName="map-legend-toggle"
      header={<strong>Layers</strong>}
      groups={groups}
      visible={visible}
      onToggle={onToggle}
      onLayerVisibilityChange={onLayerVisibilityChange}
    />
  );
}
