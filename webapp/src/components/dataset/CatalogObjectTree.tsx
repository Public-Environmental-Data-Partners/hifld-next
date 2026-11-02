import type { CatalogObject, DatasetFormat } from "@/lib/api-client";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";

interface ObjectNode {
  name: string;
  children: Map<string, ObjectNode>;
  objects: CatalogObject[];
}

function objectTree(objects: CatalogObject[]): ObjectNode {
  const root: ObjectNode = { name: "", children: new Map(), objects: [] };
  for (const object of objects) {
    let node = root;
    for (const name of object.relative_path.split("/")) {
      let child = node.children.get(name);
      if (!child) {
        child = { name, children: new Map(), objects: [] };
        node.children.set(name, child);
      }
      node = child;
    }
    node.objects.push(object);
  }
  return root;
}

function ObjectNodes({ node }: { node: ObjectNode }) {
  return (
    <ul className="space-y-2 pl-4 border-l border-muted">
      {[...node.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => (
          <li key={child.name}>
            <details>
              <summary className="cursor-pointer text-sm font-mono break-all">
                <span>{child.name}</span>
                {child.objects.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {child.objects.reduce((total, object) => total + object.size_bytes, 0).toLocaleString()} B
                  </span>
                )}
              </summary>
              {child.children.size > 0 && <ObjectNodes node={child} />}
              {child.objects.map((object) => (
                <div key={object.object_key} className="space-y-2 py-2 text-xs">
                  {object.sha256 && (
                    <p className="break-all">
                      SHA-256: <code>{object.sha256}</code>
                    </p>
                  )}
                  {object.checksum_multihash && (
                    <p className="break-all">
                      Multihash: <code>{object.checksum_multihash}</code>
                    </p>
                  )}
                  <p className="break-all text-muted-foreground">{object.url}</p>
                  <div className="flex gap-2">
                    <CopyButton value={object.url} label="Copy URL" />
                    <DownloadButton url={object.url} label="Download" sizeBytes={object.size_bytes} />
                  </div>
                </div>
              ))}
            </details>
          </li>
        ))}
    </ul>
  );
}

interface ObjectGroup {
  version: string;
  location: string;
  objects: Map<string, CatalogObject>;
}

const formatLabels = new Map([
  ["json", "JSON"],
  ["xml", "XML"],
  ["csv", "CSV"],
  ["metadata", "Metadata"],
  ["pdf", "PDF"],
  ["geoparquet", "GeoParquet"],
  ["pmtiles", "PMTiles"],
  ["geopackage", "GeoPackage"],
  ["shapefile", "Shapefile"],
  ["geojson", "GeoJSON"],
  ["file_geodatabase", "File geodatabase"],
]);

export function CatalogObjectTree({ formats }: { formats: DatasetFormat[] }) {
  const groupedFormats = new Map<string, Map<string, ObjectGroup>>();
  for (const format of formats) {
    for (const source of format.sources) {
      if (!source.objects?.length) continue;
      const formatType = format.format.format_type;
      const groups = groupedFormats.get(formatType) ?? new Map<string, ObjectGroup>();
      groupedFormats.set(formatType, groups);
      const version = String(source.version ?? source.location.version);
      const locationId = source.storage_location?.slug ?? source.storage_location?.id ?? "default";
      const groupKey = JSON.stringify([version, locationId]);
      const group = groups.get(groupKey) ?? {
        version,
        location: source.storage_location?.name ?? "Default location",
        objects: new Map<string, CatalogObject>(),
      };
      for (const object of source.objects) group.objects.set(object.object_key, object);
      groups.set(groupKey, group);
    }
  }
  if (!groupedFormats.size) return null;
  return (
    <section aria-label="Catalog files" className="pt-4">
      <details>
        <summary className="cursor-pointer font-medium text-sm">All files</summary>
        <div className="space-y-3 pt-3">
          {[...groupedFormats].map(([formatType, groups]) => (
            <details key={formatType}>
              <summary className="cursor-pointer text-sm">
                {formatLabels.get(formatType) ?? formatType.replaceAll("_", " ").replaceAll("-", " ")}
              </summary>
              {[...groups].map(([key, group]) => (
                <details key={key} className="pl-4 py-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {group.version} · {group.location}
                  </summary>
                  <ObjectNodes node={objectTree([...group.objects.values()])} />
                </details>
              ))}
            </details>
          ))}
        </div>
      </details>
    </section>
  );
}
