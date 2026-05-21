import { ChevronDown } from "lucide-react";
import type maplibregl from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { LayerStyle, VectorLayerInfo } from "./types";
import { colorSchemes, computeQuantileBreaks, DEFAULT_BREAK_COUNT, getSampledValues } from "./utils";

function isScale(value: string): value is LayerStyle["radiusScale"] {
  return value === "linear" || value === "sqrt" || value === "log";
}

interface LayerStylingEditorProps {
  activeLayer: VectorLayerInfo | null;
  activeStyle: LayerStyle | null;
  activeBreaks: number[];
  activeColors: string[];
  mapRef: React.RefObject<maplibregl.Map | null>;
  colorSectionOpen: boolean;
  setColorSectionOpen: (open: boolean) => void;
  sizeSectionOpen: boolean;
  setSizeSectionOpen: (open: boolean) => void;
  onStyleChange: (style: LayerStyle) => void;
}

export function LayerStylingEditor({
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  mapRef,
  colorSectionOpen,
  setColorSectionOpen,
  sizeSectionOpen,
  setSizeSectionOpen,
  onStyleChange,
}: LayerStylingEditorProps) {
  if (!activeLayer || !activeStyle) {
    return (
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle className="text-base">Layer Styling</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No vector layers detected yet.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="text-base">Layer Styling</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Separator />
        <Collapsible open={colorSectionOpen} onOpenChange={setColorSectionOpen}>
          <CollapsibleTrigger className="text-sm font-medium">
            <span>Color & Opacity</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${colorSectionOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 border border-t-0 rounded-md px-3 py-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Color by Property</div>
              <Select
                value={activeStyle.colorProperty || "none"}
                onValueChange={(value) => {
                  if (value === "none") {
                    onStyleChange({
                      ...activeStyle,
                      colorProperty: null,
                      breaksText: "",
                    });
                    return;
                  }
                  const values = mapRef.current ? getSampledValues(mapRef.current, activeLayer.id, value) : [];
                  const breaks = computeQuantileBreaks(values, DEFAULT_BREAK_COUNT);
                  onStyleChange({
                    ...activeStyle,
                    colorProperty: value,
                    breaksText: breaks.join(", "),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Solid color</SelectItem>
                  {activeLayer.fields.map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Color Scheme</div>
              <Select
                value={activeStyle.colorScheme}
                onValueChange={(value) => onStyleChange({ ...activeStyle, colorScheme: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select scheme" />
                </SelectTrigger>
                <SelectContent>
                  {colorSchemes.map((scheme) => (
                    <SelectItem key={scheme.id} value={scheme.id}>
                      {scheme.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Breakpoints</div>
              {activeStyle.colorProperty ? (
                <div className="space-y-2">
                  {activeBreaks.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Breakpoints will appear once values are sampled.
                    </div>
                  ) : (
                    activeBreaks.map((value, index) => (
                      <div key={`${activeLayer.id}-break-${value}`} className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-sm border"
                          style={{ backgroundColor: activeColors[index + 1] }}
                        />
                        <Input
                          type="number"
                          value={value}
                          onChange={(event) => {
                            const next = [...activeBreaks];
                            next[index] = Number(event.target.value);
                            const normalized = next.filter((item) => !Number.isNaN(item)).sort((a, b) => a - b);
                            onStyleChange({
                              ...activeStyle,
                              breaksText: normalized.join(", "),
                            });
                          }}
                          className="h-8"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const next = activeBreaks.filter((_, idx) => idx !== index);
                            onStyleChange({
                              ...activeStyle,
                              breaksText: next.join(", "),
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = [...activeBreaks];
                      const last = current[current.length - 1];
                      const prev = current[current.length - 2];
                      const step = last !== undefined && prev !== undefined ? Math.max(1, last - prev) : 1;
                      const nextValue = (last ?? 0) + step;
                      const nextList = [...current, nextValue]
                        .filter((item) => !Number.isNaN(item))
                        .sort((a, b) => a - b);
                      onStyleChange({
                        ...activeStyle,
                        breaksText: nextList.join(", "),
                      });
                    }}
                  >
                    Add breakpoint
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Pick a property to enable breakpoints.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Opacity</div>
              <Slider
                value={[activeStyle.opacity]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(value) =>
                  onStyleChange({
                    ...activeStyle,
                    opacity: value[0] ?? activeStyle.opacity,
                  })
                }
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={sizeSectionOpen} onOpenChange={setSizeSectionOpen}>
          <CollapsibleTrigger className="text-sm font-medium">
            <span>Size</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${sizeSectionOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 border border-t-0 rounded-md px-3 py-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Point Radius by Field</div>
              <Select
                value={activeStyle.radiusProperty || "none"}
                onValueChange={(value) =>
                  onStyleChange({
                    ...activeStyle,
                    radiusProperty: value === "none" ? null : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Fixed size</SelectItem>
                  {activeLayer.fields.map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">Scales between half and double the radius slider.</div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Point Radius</div>
              <Slider
                value={[activeStyle.radius]}
                min={1}
                max={12}
                step={1}
                onValueChange={(value) =>
                  onStyleChange({
                    ...activeStyle,
                    radius: value[0] ?? activeStyle.radius,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Point Scale</div>
              <Select
                value={activeStyle.radiusScale}
                onValueChange={(value) =>
                  isScale(value) ? onStyleChange({ ...activeStyle, radiusScale: value }) : undefined
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="sqrt">Square root</SelectItem>
                  <SelectItem value="log">Log</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Line Thickness by Field</div>
              <Select
                value={activeStyle.lineWidthProperty || "none"}
                onValueChange={(value) =>
                  onStyleChange({
                    ...activeStyle,
                    lineWidthProperty: value === "none" ? null : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Fixed size</SelectItem>
                  {activeLayer.fields.map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">Scales between half and double the thickness slider.</div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Line Thickness</div>
              <Slider
                value={[activeStyle.lineWidth]}
                min={1}
                max={8}
                step={1}
                onValueChange={(value) =>
                  onStyleChange({
                    ...activeStyle,
                    lineWidth: value[0] ?? activeStyle.lineWidth,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Line Scale</div>
              <Select
                value={activeStyle.lineWidthScale}
                onValueChange={(value) =>
                  isScale(value) ? onStyleChange({ ...activeStyle, lineWidthScale: value }) : undefined
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="sqrt">Square root</SelectItem>
                  <SelectItem value="log">Log</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
