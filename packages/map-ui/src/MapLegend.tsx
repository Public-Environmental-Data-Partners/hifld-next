import { Eye, EyeOff, Info, X } from "lucide-react";
import type { ReactNode } from "react";

export interface MapLegendItem {
  label: string;
  color: string;
}

export interface MapLegendGroup {
  id: string;
  title: string;
  field?: string | null | undefined;
  items: readonly MapLegendItem[];
  layerVisible?: boolean | undefined;
}

export interface MapLegendProps {
  groups: readonly MapLegendGroup[];
  title?: string | undefined;
  header?: ReactNode;
  visible: boolean;
  onToggle: () => void;
  onLayerVisibilityChange?: ((id: string, visible: boolean) => void) | undefined;
  className?: string | undefined;
  toggleClassName?: string | undefined;
  renderCollapsedToggle?: ((button: MapLegendButton) => ReactNode) | undefined;
  renderCloseButton?: ((button: MapLegendButton) => ReactNode) | undefined;
}

export interface MapLegendButton {
  ariaLabel: string;
  onClick: () => void;
  icon: ReactNode;
}

export function MapLegend({
  groups,
  title,
  header,
  visible,
  onToggle,
  onLayerVisibilityChange,
  className,
  toggleClassName,
  renderCollapsedToggle,
  renderCloseButton,
}: MapLegendProps): ReactNode {
  const toggleLabel = title ? `Hide ${title}` : "Hide color key";
  const showLabel = title ? `Show ${title}` : "Show color key";

  if (!visible) {
    const button: MapLegendButton = {
      ariaLabel: showLabel,
      onClick: onToggle,
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
    };
    if (renderCollapsedToggle) {
      return renderCollapsedToggle(button);
    }
    return (
      <button
        type="button"
        className={
          toggleClassName ?? "hifld-map-legend-toggle absolute bottom-4 left-4 z-10 h-9 w-9 shadow-md"
        }
        onClick={button.onClick}
        aria-label={button.ariaLabel}
      >
        {button.icon}
      </button>
    );
  }

  return (
    <section
      className={
        className ??
        "hifld-map-legend absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-2rem)] max-w-[min(22rem,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg sm:bottom-6 sm:left-6 sm:max-h-[min(24rem,calc(100%-3rem))] sm:max-w-[min(22rem,calc(100%-3rem))]"
      }
      aria-label="Map legend"
    >
      <div data-slot="map-legend-header" className="shrink-0 flex items-center justify-between gap-4 border-b px-4 py-3">
        {header ?? (title ? (
          <h3 className="max-w-36 truncate text-sm font-semibold" title={title}>
            {title}
          </h3>
        ) : (
          <span aria-hidden="true" className="h-6" />
        ))}
        {renderCloseButton ? (
          renderCloseButton({
            ariaLabel: toggleLabel,
            onClick: onToggle,
            icon: <X className="h-3 w-3" aria-hidden="true" />,
          })
        ) : (
          <button type="button" onClick={onToggle} aria-label={toggleLabel}>
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
      <div data-slot="map-legend-scroll" data-testid="map-legend-scroll" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {groups.map((group) => (
            <section data-slot="map-legend-group" className="space-y-2" key={group.id}>
            {onLayerVisibilityChange ? (
              <div data-slot="map-legend-layer-toggle" className="flex items-center gap-2 text-xs font-medium" title={group.title}>
                <strong
                  data-slot="map-legend-group-title"
                  className="min-w-0 flex-1 truncate"
                >
                  {group.title}
                </strong>
                <button
                  type="button"
                  data-slot="map-legend-layer-visibility"
                  className="ml-auto grid h-6 w-6 shrink-0 place-items-center border-0 bg-transparent p-0 shadow-none"
                  aria-label={`${(group.layerVisible ?? true) ? "Hide" : "Show"} ${group.title}`}
                  aria-pressed={group.layerVisible ?? true}
                  title={group.layerVisible ?? true ? "Hide layer" : "Show layer"}
                  onClick={() => onLayerVisibilityChange(group.id, !(group.layerVisible ?? true))}
                >
                  {group.layerVisible ?? true ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            ) : (
              <div data-slot="map-legend-group-title" className="truncate text-xs font-medium" title={group.title}>
                {group.title}
              </div>
            )}
            <div data-slot="map-legend-label" className="truncate text-xs text-muted-foreground" title={group.field ?? "Solid color"}>
              {group.field ? `Color by ${group.field}` : "Solid color"}
            </div>
            <div data-slot="map-legend-items" className="space-y-1.5">
              {group.items.map((item) => (
                <div data-slot="map-legend-item" className="flex items-center gap-2 text-xs" key={`${group.id}-${item.label}`}>
                  <span data-slot="map-legend-swatch" className="h-3 w-3 shrink-0 rounded-sm border" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-muted-foreground" title={item.label}>{item.label}</span>
                </div>
              ))}
            </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
