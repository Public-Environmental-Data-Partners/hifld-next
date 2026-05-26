import { createFileRoute, Link, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeftRight, Map as MapIcon } from "lucide-react";
import { z } from "zod";
import { VersionCompare } from "@/components/dataset/VersionCompare";
import {
  decodeSourceDescriptor,
  descriptorForSource,
  encodeSourceDescriptor,
  findSourceForDescriptor,
  firstSourceDescriptorForFormat,
  type SourceDescriptor,
} from "@/components/map/sourceDescriptors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/page-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Dataset, DatasetFile, DatasetSource, FormatType } from "@/lib/api-client";
import { getCollectionBySlug, getCollectionDatasets, getDatasetFileBySlug } from "@/lib/api-client";

type CompareSearch = {
  left?: string;
  right?: string;
  mode?: "metadata";
};

const compareSearchSchema = z
  .object({
    left: z.string().optional(),
    right: z.string().optional(),
    mode: z.literal("metadata").optional(),
  })
  .catch({});

function parseCompareSearch(search: z.input<typeof compareSearchSchema>): CompareSearch {
  const parsed = compareSearchSchema.parse(search);
  const result: CompareSearch = {};
  if (parsed.left !== undefined) result.left = parsed.left;
  if (parsed.right !== undefined) result.right = parsed.right;
  if (parsed.mode !== undefined) result.mode = parsed.mode;
  return result;
}

interface ResolvedCompareSource {
  descriptor: SourceDescriptor;
  dataset: Dataset;
  file: DatasetFile;
  source: DatasetSource;
}

async function resolveDescriptor(descriptor: SourceDescriptor | null): Promise<ResolvedCompareSource | null> {
  if (!descriptor) return null;
  const response = await getDatasetFileBySlug({
    data: {
      collectionSlug: descriptor.collectionSlug,
      datasetSlug: descriptor.datasetSlug,
      fileSlug: descriptor.fileSlug,
    },
  });
  if (!response) return null;
  const source = findSourceForDescriptor(response.file, descriptor);
  if (!source) return null;
  return {
    descriptor,
    dataset: response.dataset,
    file: response.file,
    source,
  };
}

function labelForResolved(entry: ResolvedCompareSource): string {
  return `${entry.dataset.name} / ${entry.file.name} / ${entry.descriptor.formatType} / ${entry.source.version ?? "1"}`;
}

function datasetDescriptors(collectionSlug: string, dataset: Dataset): SourceDescriptor[] {
  const datasetWithFiles = dataset as Dataset & { files?: DatasetFile[] | undefined };
  const descriptors: SourceDescriptor[] = [];
  for (const file of datasetWithFiles.files ?? []) {
    for (const formatType of ["geoparquet", "pmtiles", "geojson", "geopackage"] satisfies FormatType[]) {
      const formatEntry = file.formats?.find((entry) => entry.format.format_type === formatType);
      const descriptor = firstSourceDescriptorForFormat({
        collectionSlug,
        datasetSlug: dataset.slug,
        fileSlug: file.slug,
        formatEntry,
      });
      if (descriptor) descriptors.push(descriptor);
    }
  }
  return descriptors;
}

export const Route = createFileRoute("/collections/$collectionSlug/compare")({
  validateSearch: parseCompareSearch,
  loaderDeps: ({ search }) => ({
    left: search.left,
    right: search.right,
  }),
  loader: async ({ deps, params }) => {
    const collection = await getCollectionBySlug({
      data: { slug: params.collectionSlug },
    });
    if (!collection) {
      throw notFound();
    }
    const [left, right, datasetsResponse] = await Promise.all([
      resolveDescriptor(decodeSourceDescriptor(deps.left)),
      resolveDescriptor(decodeSourceDescriptor(deps.right)),
      getCollectionDatasets({
        data: {
          collectionId: collection.id,
          includeUrls: true,
          limit: 100,
          offset: 0,
        },
      }),
    ]);
    return { collection, left, right, datasets: datasetsResponse.items };
  },
  component: ComparePage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
});

function ComparePage() {
  const { collection, left, right, datasets } = Route.useLoaderData();
  const { collectionSlug } = Route.useParams();
  const search = useSearch({ from: Route.fullPath });
  const navigate = useNavigate({ from: Route.fullPath });
  const descriptorOptions = datasets.flatMap((dataset) => datasetDescriptors(collection.slug, dataset));

  const updateSide = (side: "left" | "right", descriptorValue: string) =>
    navigate({
      search: {
        ...search,
        [side]: descriptorValue,
        mode: "metadata",
      },
      replace: true,
    });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ArrowLeftRight className="h-4 w-4" />
            Metadata compare
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Compare dataset sources</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Compare schema, metadata, quality, provenance, and data dictionary details across any two file-backed
            sources.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/collections/$collectionSlug/map" params={{ collectionSlug }}>
            <MapIcon className="mr-2 h-4 w-4" />
            Open map
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sources</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <SourcePicker
            label="Left source"
            value={search.left}
            options={descriptorOptions}
            resolved={left}
            onChange={(value) => updateSide("left", value)}
          />
          <SourcePicker
            label="Right source"
            value={search.right}
            options={descriptorOptions}
            resolved={right}
            onChange={(value) => updateSide("right", value)}
          />
        </CardContent>
      </Card>

      {left && right ? (
        <VersionCompare
          leftSource={left.source}
          rightSource={right.source}
          leftLabel={`Left source: ${labelForResolved(left)}`}
          rightLabel={`Right source: ${labelForResolved(right)}`}
        />
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Choose two sources to compare. Dataset file pages can also open this page with both sides prefilled.
        </div>
      )}
    </div>
  );
}

function SourcePicker({
  label,
  value,
  options,
  resolved,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: SourceDescriptor[];
  resolved: ResolvedCompareSource | null;
  onChange: (value: string) => void;
}) {
  const resolvedValue =
    resolved &&
    descriptorForSource({
      collectionSlug: resolved.descriptor.collectionSlug,
      datasetSlug: resolved.dataset.slug,
      fileSlug: resolved.file.slug,
      formatType: resolved.descriptor.formatType,
      source: resolved.source,
    });
  const selectValue = value ?? (resolvedValue ? encodeSourceDescriptor(resolvedValue) : "");

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <Select value={selectValue} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select source" />
        </SelectTrigger>
        <SelectContent>
          {options.slice(0, 80).map((descriptor) => (
            <SelectItem key={encodeSourceDescriptor(descriptor)} value={encodeSourceDescriptor(descriptor)}>
              {descriptor.datasetSlug} / {descriptor.fileSlug} / {descriptor.formatType} / {descriptor.version}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {resolved ? (
        <p className="text-xs text-muted-foreground">{labelForResolved(resolved)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">No source selected.</p>
      )}
    </div>
  );
}
