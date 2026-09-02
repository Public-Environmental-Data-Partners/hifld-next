import { ExternalLink, MessageSquareWarning, MoreHorizontal, X } from "lucide-react";
import type { Ref } from "react";
import { DataQualityFeedbackDialog } from "@/components/dataset/DataQualityFeedbackDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { googleMapsSearchUrl } from "@/lib/externalMaps";
import {
  type CatalogSelectedMapFeature,
  isCatalogSelectedMapFeature,
  type SelectedMapFeature,
} from "../map/featureSelection";
import type { HoverInfo, PopupPropertyEntry } from "./types";

interface FeatureHoverPopupProps {
  hoverInfo: HoverInfo;
  selectedIndex: number;
  propertyEntries: PopupPropertyEntry[];
  selectedMapFeature?: SelectedMapFeature | null | undefined;
  onIndexChange: (index: number) => void;
  onClose?: () => void;
  popupRef?: Ref<HTMLDivElement> | undefined;
}

export function FeatureHoverPopup({
  hoverInfo,
  selectedIndex,
  propertyEntries,
  selectedMapFeature,
  onIndexChange,
  onClose,
  popupRef,
}: FeatureHoverPopupProps) {
  const selectedFeature = hoverInfo.features[selectedIndex];
  const layerId = selectedFeature?.layer?.id || "Feature";
  const isPinned = hoverInfo.isPinned ?? false;

  return (
    <div
      ref={popupRef}
      className="absolute z-10 max-w-md rounded-md border bg-background/95 shadow-md"
      style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
    >
      <div className="border-b">
        <div className="flex items-center justify-between gap-2 px-3 py-2 min-w-0">
          <div className="text-xs text-muted-foreground truncate min-w-0 flex-1">{layerId}</div>
          <div className="flex shrink-0 items-center gap-1">
            {selectedMapFeature && isCatalogSelectedMapFeature(selectedMapFeature) ? (
              <FeaturePopupActions selectedMapFeature={selectedMapFeature} />
            ) : null}
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
                    key={
                      feature.id === undefined
                        ? `${feature.layer?.id ?? "feature"}-${feature.sourceLayer ?? "feature"}-${index}`
                        : `${feature.layer?.id ?? "feature"}-${String(feature.id)}`
                    }
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
      <div
        data-testid="feature-popup-scroll"
        className="max-h-[min(12rem,calc(100dvh-14rem))] touch-pan-y overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
      >
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
      </div>
    </div>
  );
}

function FeaturePopupActions({ selectedMapFeature }: { selectedMapFeature: CatalogSelectedMapFeature }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" aria-label="Feature actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1" side="bottom">
        <div className="flex flex-col gap-1">
          {selectedMapFeature.centroid ? (
            <Button variant="ghost" size="sm" asChild className="justify-start">
              <a href={googleMapsSearchUrl(selectedMapFeature.centroid)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Google Maps
              </a>
            </Button>
          ) : null}
          <DataQualityFeedbackDialog
            context={{
              collectionSlug: selectedMapFeature.collectionSlug,
              datasetSlug: selectedMapFeature.datasetSlug,
              fileSlug: selectedMapFeature.fileSlug,
              version: selectedMapFeature.version,
              sourceId: selectedMapFeature.sourceId,
              feature: selectedMapFeature,
            }}
            trigger={
              <Button variant="ghost" size="sm" className="justify-start">
                <MessageSquareWarning className="mr-2 h-4 w-4" />
                Report issue
              </Button>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
