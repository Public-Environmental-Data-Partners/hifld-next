import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HoverInfo, PopupPropertyEntry } from "./types";

interface FeatureHoverPopupProps {
  hoverInfo: HoverInfo;
  selectedIndex: number;
  propertyEntries: PopupPropertyEntry[];
  onIndexChange: (index: number) => void;
  onClose?: () => void;
}

export function FeatureHoverPopup({
  hoverInfo,
  selectedIndex,
  propertyEntries,
  onIndexChange,
  onClose,
}: FeatureHoverPopupProps) {
  const selectedFeature = hoverInfo.features[selectedIndex];
  const layerId = selectedFeature?.layer?.id || "Feature";
  const isPinned = hoverInfo.isPinned ?? false;

  return (
    <div
      className="absolute z-10 max-w-md rounded-md border bg-background/95 shadow-md"
      style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
    >
      <div className="border-b">
        <div className="flex items-center justify-between gap-2 px-3 py-2 min-w-0">
          <div className="text-xs text-muted-foreground truncate min-w-0 flex-1">{layerId}</div>
          {isPinned && onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={onClose}
              aria-label="Close popup"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {hoverInfo.features.length > 1 && (
          <div className="px-3 pb-2">
            <Select value={String(selectedIndex)} onValueChange={(value) => onIndexChange(Number(value))}>
              <SelectTrigger className="h-7 w-full">
                <SelectValue placeholder="Select feature" />
              </SelectTrigger>
              <SelectContent>
                {hoverInfo.features.map((feature, index) => (
                  <SelectItem
                    key={`${feature.layer?.id ?? "feature"}-${String(feature.id ?? feature.sourceLayer)}`}
                    value={String(index)}
                  >
                    {feature.layer?.id || "Feature"} #{index + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <ScrollArea className="h-48">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {propertyEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-xs text-muted-foreground">
                  No properties available.
                </TableCell>
              </TableRow>
            ) : (
              propertyEntries.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-medium">{key}</TableCell>
                  <TableCell className="break-all text-xs">{String(value)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
