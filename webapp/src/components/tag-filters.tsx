import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/utils";

export interface TagFilter {
  key: string;
  value: string;
  label?: string;
}

export interface AvailableTagValues {
  [tagKey: string]: string[] | undefined;
}

export interface TagKeyLabelMap {
  [tagKey: string]: string | undefined;
}

export interface TagFiltersProps {
  availableTags: AvailableTagValues;
  selectedFilters: TagFilter[];
  onFilterChange: (key: string, values: string[]) => void;
  className?: string;
  tagKeyLabels?: TagKeyLabelMap; // Optional custom labels for tag keys
}

export function TagFilters({
  availableTags,
  selectedFilters,
  onFilterChange,
  className,
  tagKeyLabels = {},
}: TagFiltersProps) {
  // Format tag key for display (convert snake_case to Title Case if no custom label)
  const getTagKeyLabel = (key: string): string => {
    if (tagKeyLabels[key]) {
      return tagKeyLabels[key];
    }
    // Convert snake_case to Title Case
    return key
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Group selected filters by key
  const selectedByKey: AvailableTagValues = {};
  for (const filter of selectedFilters) {
    selectedByKey[filter.key] = [...(selectedByKey[filter.key] ?? []), filter.value];
  }

  if (Object.keys(availableTags).length === 0) {
    return null;
  }

  // Get unique tag keys, sorted alphabetically for consistent display
  const tagKeys = Object.keys(availableTags).sort();

  return (
    <div className={cn("space-y-4 min-w-0", className)}>
      {/* Show selected filters with remove buttons */}
      {selectedFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center min-w-0">
          <span className="font-mono text-xs tracking-wide text-muted-foreground mr-2 uppercase shrink-0">
            Active filters:
          </span>
          {selectedFilters.map((filter) => {
            const label = getTagKeyLabel(filter.key);
            return (
              <Badge
                key={`${filter.key}-${filter.value}`}
                variant="default"
                className="cursor-pointer hover:bg-primary/80 gap-1 pr-1 break-words max-w-full"
                onClick={() => {
                  const currentValues = selectedByKey[filter.key] || [];
                  const newValues = currentValues.filter((v) => v !== filter.value);
                  onFilterChange(filter.key, newValues);
                }}
              >
                <span className="break-words">
                  {label}: {filter.value}
                </span>
                <X className="h-3 w-3 shrink-0" />
              </Badge>
            );
          })}
        </div>
      )}

      {/* Show multi-select dropdowns for each unique tag key */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 min-w-0">
        {tagKeys.map((key) => {
          const values = availableTags[key];
          if (!values) return null;
          if (values.length === 0) return null;

          const label = getTagKeyLabel(key);
          const selectedValues = selectedByKey[key] || [];
          const options = values.map((value) => ({
            label: value,
            value: value,
          }));

          return (
            <div key={key} className="space-y-2 min-w-0">
              <span className="font-mono text-xs font-medium tracking-wide uppercase text-foreground break-words">
                {label}
              </span>
              <MultiSelect
                options={options}
                selected={selectedValues}
                onChange={(newValues) => onFilterChange(key, newValues)}
                placeholder={`Select ${label.toLowerCase()}...`}
                maxDisplay={2}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
