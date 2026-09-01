import {
  Eraser,
  MapIcon,
  Maximize,
  PanelLeft,
  Satellite,
  ScanSearch,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  CLEAR_SELECTION_CONTROL_ARIA_LABEL,
  CLEAR_SELECTION_CONTROL_LABEL,
  getBasemapControlLabel,
  getSelectionControlAriaLabel,
  getSelectionControlLabel,
} from "@hifld/map-core";

export type MapBasemapMode = "street" | "satellite";

export type MapControlId = "settings" | "selection" | "clear-selection" | "basemap" | "zoom-in" | "zoom-out" | "fullscreen";

export interface MapControl {
  id: MapControlId;
  ariaLabel: string;
  label: string;
  active?: boolean | undefined;
  onClick: () => void;
  icon: ReactNode;
}

export interface MapControlsProps {
  basemapMode: MapBasemapMode;
  isSelectionActive: boolean;
  onToggleSelection?: (() => void) | undefined;
  onToggleBasemap?: (() => void) | undefined;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleSettings?: (() => void) | undefined;
  isSettingsCollapsed?: boolean | undefined;
  onClearSelection?: (() => void) | undefined;
  onFullscreen?: (() => void) | undefined;
  className?: string | undefined;
  renderControl?: ((control: MapControl) => ReactNode) | undefined;
}

function defaultControl(control: MapControl): ReactNode {
  return (
    <button
      type="button"
      className={`hifld-map-control-button${control.active ? " hifld-map-control-button-active" : ""}`}
      onClick={control.onClick}
      aria-label={control.ariaLabel}
      aria-pressed={control.active}
      title={control.label}
    >
      {control.icon}
    </button>
  );
}

export function MapControls({
  basemapMode,
  isSelectionActive,
  onToggleSelection,
  onToggleBasemap,
  onZoomIn,
  onZoomOut,
  onToggleSettings,
  isSettingsCollapsed,
  onClearSelection,
  onFullscreen,
  className,
  renderControl,
}: MapControlsProps): ReactNode {
  const selectionLabel = getSelectionControlLabel(isSelectionActive);
  const controls: MapControl[] = [
    ...(onToggleSettings
      ? [
          {
            id: "settings" as const,
            ariaLabel: isSettingsCollapsed ? "Show map settings" : "Hide map settings",
            label: isSettingsCollapsed ? "Show map settings" : "Hide map settings",
            onClick: onToggleSettings,
            icon: <PanelLeft className="h-4 w-4" aria-hidden="true" />,
          },
        ]
      : []),
    ...(onToggleSelection
      ? [
          {
            id: "selection" as const,
            ariaLabel: getSelectionControlAriaLabel(isSelectionActive),
            label: selectionLabel,
            active: isSelectionActive,
            onClick: onToggleSelection,
            icon: <ScanSearch className="h-4 w-4" aria-hidden="true" />,
          },
        ]
      : []),
    ...(onClearSelection
      ? [
          {
            id: "clear-selection" as const,
            ariaLabel: CLEAR_SELECTION_CONTROL_ARIA_LABEL,
            label: CLEAR_SELECTION_CONTROL_LABEL,
            onClick: onClearSelection,
            icon: <Eraser className="h-4 w-4" aria-hidden="true" />,
          },
        ]
      : []),
    ...(onToggleBasemap
      ? [
          {
            id: "basemap" as const,
            ariaLabel: getBasemapControlLabel(basemapMode),
            label: getBasemapControlLabel(basemapMode),
            onClick: onToggleBasemap,
            icon:
              basemapMode === "satellite" ? (
                <MapIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Satellite className="h-4 w-4" aria-hidden="true" />
              ),
          },
        ]
      : []),
    {
      id: "zoom-in",
      ariaLabel: "Zoom in",
      label: "Zoom in",
      onClick: onZoomIn,
      icon: <ZoomIn className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: "zoom-out",
      ariaLabel: "Zoom out",
      label: "Zoom out",
      onClick: onZoomOut,
      icon: <ZoomOut className="h-4 w-4" aria-hidden="true" />,
    },
    ...(onFullscreen
      ? [
          {
            id: "fullscreen" as const,
            ariaLabel: "Full screen",
            label: "Full screen",
            onClick: onFullscreen,
            icon: <Maximize className="h-4 w-4" aria-hidden="true" />,
          },
        ]
      : []),
  ];

  return (
    <div className={className ?? "hifld-map-controls"} role="toolbar" aria-label="Map controls">
      {controls.map((control) => (
        <span data-slot="map-control" key={control.id}>
          {renderControl?.(control) ?? defaultControl(control)}
        </span>
      ))}
    </div>
  );
}
