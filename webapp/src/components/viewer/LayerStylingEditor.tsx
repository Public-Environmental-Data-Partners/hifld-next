import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { LayerStyle, NumericFieldSummary, VectorLayerInfo } from "./types";
import { automaticBreaksForNumericField, colorSchemes, DEFAULT_BREAK_COUNT } from "./utils";

function isScale(value: string): value is LayerStyle["radiusScale"] {
  return value === "linear" || value === "sqrt" || value === "log";
}

function activeNumericField(layer: VectorLayerInfo, property: string | null): NumericFieldSummary | undefined {
  if (!property) {
    return undefined;
  }
  return layer.numericFields.find((field) => field.name === property);
}

function automaticBreaksForProperty({
  layer,
  property,
  getSampledBreaks,
}: {
  layer: VectorLayerInfo;
  property: string;
  getSampledBreaks: (layer: VectorLayerInfo, property: string) => number[];
}): number[] {
  const summary = activeNumericField(layer, property);
  const sampledValues = getSampledBreaks(layer, property);
  return automaticBreaksForNumericField({
    field: summary,
    sampledValues,
    count: DEFAULT_BREAK_COUNT,
  });
}

function geometryTypeSupports(geometryType: string | undefined, candidates: string[]): boolean {
  if (!geometryType) {
    return true;
  }
  const normalized = geometryType.toLowerCase();
  if (normalized === "mixed" || normalized === "geometry") {
    return true;
  }
  return candidates.some((candidate) => normalized.includes(candidate));
}

function normalizeBreaks(values: number[]): number[] {
  return values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b);
}

function BreakpointInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commit = () => {
    const nextValue = Number(draftValue);
    if (!Number.isFinite(nextValue)) {
      setDraftValue(String(value));
      return;
    }
    onCommit(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      commit();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraftValue(String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <Input
      type="number"
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className="h-8"
    />
  );
}

function NumericFieldOptions({ fields }: { fields: NumericFieldSummary[] }) {
  return fields.map((field) => (
    <SelectItem key={field.name} value={field.name}>
      {field.name}
    </SelectItem>
  ));
}

interface BreakpointsEditorProps {
  activeLayer: VectorLayerInfo;
  activeStyle: LayerStyle;
  activeBreaks: number[];
  activeColors: string[];
  getSampledBreaks: (layer: VectorLayerInfo, property: string) => number[];
  onStyleChange: (style: LayerStyle) => void;
}

function BreakpointsEditor({
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  getSampledBreaks,
  onStyleChange,
}: BreakpointsEditorProps) {
  const activeColorField = activeNumericField(activeLayer, activeStyle.colorProperty);

  const updateBreakAt = (index: number, nextValue: number) => {
    const next = [...activeBreaks];
    next[index] = nextValue;
    onStyleChange({ ...activeStyle, breaksText: normalizeBreaks(next).join(", "), breakMode: "manual" });
  };

  const removeBreakAt = (value: number) => {
    const next = activeBreaks.filter((breakValue) => breakValue !== value);
    onStyleChange({ ...activeStyle, breaksText: next.join(", "), breakMode: "manual" });
  };

  const addBreakpoint = () => {
    const current = [...activeBreaks];
    const last = current[current.length - 1];
    const prev = current[current.length - 2];
    const step = last !== undefined && prev !== undefined ? Math.max(1, last - prev) : 1;
    const nextList = normalizeBreaks([...current, (last ?? 0) + step]);
    onStyleChange({ ...activeStyle, breaksText: nextList.join(", "), breakMode: "manual" });
  };

  const setMode = (value: string) => {
    if (value !== "auto" && value !== "manual") {
      return;
    }
    if (value === "auto" && activeStyle.colorProperty) {
      const breaks = automaticBreaksForProperty({
        layer: activeLayer,
        property: activeStyle.colorProperty,
        getSampledBreaks,
      });
      onStyleChange({ ...activeStyle, breakMode: "auto", breaksText: breaks.join(", ") });
      return;
    }
    onStyleChange({ ...activeStyle, breakMode: value });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">Breakpoints</div>
        {activeStyle.colorProperty ? (
          <Select value={activeStyle.breakMode} onValueChange={setMode}>
            <SelectTrigger aria-label="Breakpoint mode" className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {activeStyle.colorProperty ? (
        <div className="space-y-2">
          {activeBreaks.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {activeColorField
                ? "No numeric range is available yet. Pan or zoom to load values, or add manual breakpoints."
                : "This property is not available for numeric styling."}
            </div>
          ) : (
            activeBreaks.map((value, index) => (
              <div key={`${activeLayer.id}-break-${value}`} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm border" style={{ backgroundColor: activeColors[index + 1] }} />
                <BreakpointInput value={value} onCommit={(nextValue) => updateBreakAt(index, nextValue)} />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeBreakAt(value)}>
                  Remove
                </Button>
              </div>
            ))
          )}
          <Button type="button" variant="outline" size="sm" onClick={addBreakpoint}>
            Add breakpoint
          </Button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Pick a property to enable breakpoints.</div>
      )}
    </div>
  );
}

interface ColorOpacitySectionProps {
  activeLayer: VectorLayerInfo;
  activeStyle: LayerStyle;
  activeBreaks: number[];
  activeColors: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getSampledBreaks: (layer: VectorLayerInfo, property: string) => number[];
  onStyleChange: (style: LayerStyle) => void;
}

function ColorOpacitySection({
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  open,
  onOpenChange,
  getSampledBreaks,
  onStyleChange,
}: ColorOpacitySectionProps) {
  const numericFields = activeLayer.numericFields;

  const setColorProperty = (value: string) => {
    if (value === "none") {
      onStyleChange({ ...activeStyle, colorProperty: null, breaksText: "" });
      return;
    }
    const breaks = automaticBreaksForProperty({ layer: activeLayer, property: value, getSampledBreaks });
    onStyleChange({ ...activeStyle, colorProperty: value, breaksText: breaks.join(", "), breakMode: "auto" });
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="text-sm font-medium">
        <span>Color & Opacity</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border border-t-0 rounded-md px-3 py-3">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Color by Property</div>
          <Select value={activeStyle.colorProperty || "none"} onValueChange={setColorProperty}>
            <SelectTrigger>
              <SelectValue placeholder="Select property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Solid color</SelectItem>
              <NumericFieldOptions fields={numericFields} />
            </SelectContent>
          </Select>
          {numericFields.length === 0 && (
            <div className="text-xs text-muted-foreground">No numeric fields are available for color styling.</div>
          )}
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

        <BreakpointsEditor
          activeLayer={activeLayer}
          activeStyle={activeStyle}
          activeBreaks={activeBreaks}
          activeColors={activeColors}
          getSampledBreaks={getSampledBreaks}
          onStyleChange={onStyleChange}
        />

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Opacity</div>
          <Slider
            value={[activeStyle.opacity]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(value) => onStyleChange({ ...activeStyle, opacity: value[0] ?? activeStyle.opacity })}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface SizeSectionProps {
  activeLayer: VectorLayerInfo;
  activeStyle: LayerStyle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (style: LayerStyle) => void;
}

function SizeSection({ activeLayer, activeStyle, open, onOpenChange, onStyleChange }: SizeSectionProps) {
  const numericFields = activeLayer.numericFields;
  const supportsPointStyling = geometryTypeSupports(activeLayer.geometryType, ["point"]);
  const supportsLineStyling = geometryTypeSupports(activeLayer.geometryType, ["line"]);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="text-sm font-medium">
        <span>Size</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border border-t-0 rounded-md px-3 py-3">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Point Radius by Field</div>
          {supportsPointStyling ? (
            <>
              <Select
                value={activeStyle.radiusProperty || "none"}
                onValueChange={(value) =>
                  onStyleChange({ ...activeStyle, radiusProperty: value === "none" ? null : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Fixed size</SelectItem>
                  <NumericFieldOptions fields={numericFields} />
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">Scales between half and double the radius slider.</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Point radius does not apply to this layer type.</div>
          )}
        </div>

        {supportsPointStyling && (
          <>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Point Radius</div>
              <Slider
                value={[activeStyle.radius]}
                min={1}
                max={12}
                step={1}
                onValueChange={(value) => onStyleChange({ ...activeStyle, radius: value[0] ?? activeStyle.radius })}
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
          </>
        )}

        <Separator />

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Line Thickness by Field</div>
          {supportsLineStyling ? (
            <>
              <Select
                value={activeStyle.lineWidthProperty || "none"}
                onValueChange={(value) =>
                  onStyleChange({ ...activeStyle, lineWidthProperty: value === "none" ? null : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Fixed size</SelectItem>
                  <NumericFieldOptions fields={numericFields} />
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">Scales between half and double the thickness slider.</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Line thickness does not apply to this layer type.</div>
          )}
        </div>

        {supportsLineStyling && (
          <>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Line Thickness</div>
              <Slider
                value={[activeStyle.lineWidth]}
                min={1}
                max={8}
                step={1}
                onValueChange={(value) =>
                  onStyleChange({ ...activeStyle, lineWidth: value[0] ?? activeStyle.lineWidth })
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
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface LayerStylingEditorProps {
  activeLayer: VectorLayerInfo | null;
  activeStyle: LayerStyle | null;
  activeBreaks: number[];
  activeColors: string[];
  colorSectionOpen: boolean;
  setColorSectionOpen: (open: boolean) => void;
  sizeSectionOpen: boolean;
  setSizeSectionOpen: (open: boolean) => void;
  onStyleChange: (style: LayerStyle) => void;
  getSampledBreaks?: (layer: VectorLayerInfo, property: string) => number[];
  embedded?: boolean | undefined;
  title?: string | undefined;
  showTitle?: boolean | undefined;
}

export function LayerStylingEditor({
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  colorSectionOpen,
  setColorSectionOpen,
  sizeSectionOpen,
  setSizeSectionOpen,
  onStyleChange,
  getSampledBreaks = () => [],
  embedded = false,
  title = "Layer Styling",
  showTitle = true,
}: LayerStylingEditorProps) {
  if (!activeLayer || !activeStyle) {
    if (embedded) {
      return (
        <div className="space-y-2">
          {showTitle && <div className="text-sm font-semibold">{title}</div>}
          <div className="text-sm text-muted-foreground">No vector layers detected yet.</div>
        </div>
      );
    }

    return (
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No vector layers detected yet.</div>
        </CardContent>
      </Card>
    );
  }

  const editorContent = (
    <div className="min-w-0 space-y-4 overflow-hidden">
      <Separator />
      <ColorOpacitySection
        activeLayer={activeLayer}
        activeStyle={activeStyle}
        activeBreaks={activeBreaks}
        activeColors={activeColors}
        open={colorSectionOpen}
        onOpenChange={setColorSectionOpen}
        getSampledBreaks={getSampledBreaks}
        onStyleChange={onStyleChange}
      />
      <SizeSection
        activeLayer={activeLayer}
        activeStyle={activeStyle}
        open={sizeSectionOpen}
        onOpenChange={setSizeSectionOpen}
        onStyleChange={onStyleChange}
      />
    </div>
  );

  if (embedded) {
    return (
      <div className="min-w-0 space-y-3">
        {showTitle && <div className="text-sm font-semibold">{title}</div>}
        {editorContent}
      </div>
    );
  }

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{editorContent}</CardContent>
    </Card>
  );
}
