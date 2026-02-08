import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HoverInfo } from "./types";

interface FeatureHoverPopupProps {
  hoverInfo: HoverInfo;
  selectedIndex: number;
  propertyEntries: Array<[string, any]>;
  onIndexChange: (index: number) => void;
}

export function FeatureHoverPopup({
  hoverInfo,
  selectedIndex,
  propertyEntries,
  onIndexChange,
}: FeatureHoverPopupProps) {
  const selectedFeature = hoverInfo.features[selectedIndex];
  const layerId = selectedFeature?.layer?.id || "Feature";

  return (
    <div
      className="absolute z-10 max-w-md rounded-md border bg-background/95 shadow-md"
      style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">{layerId}</div>
        {hoverInfo.features.length > 1 && (
          <Select
            value={String(selectedIndex)}
            onValueChange={(value) => onIndexChange(Number(value))}
          >
            <SelectTrigger className="h-7 w-[160px]">
              <SelectValue placeholder="Select feature" />
            </SelectTrigger>
            <SelectContent>
              {hoverInfo.features.map((feature, index) => (
                <SelectItem key={`${feature.layer?.id}-${index}`} value={String(index)}>
                  {feature.layer?.id || "Feature"} #{index + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                  <TableCell className="break-all text-xs">
                    {String(value)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

