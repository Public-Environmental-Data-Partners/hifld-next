import { env } from "@/env/server";
import { CatalogLifecycle, type CatalogSource } from "@/lib/catalog-repository";

let lifecycle: CatalogLifecycle | null = null;
let starting: Promise<void> | null = null;
let started = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function configuredSource(): CatalogSource | null {
  if (env.CATALOG_SQLITE_PATH) return { kind: "file", path: env.CATALOG_SQLITE_PATH };
  if (env.CATALOG_RELEASE_POINTER_URL) return { kind: "pointer", url: env.CATALOG_RELEASE_POINTER_URL };
  if (env.CATALOG_SQLITE_URL) return { kind: "url", url: env.CATALOG_SQLITE_URL };
  return null;
}

/** Returns null only in explicitly configured legacy/dual-read mode. */
export async function activeCatalogLifecycle(): Promise<CatalogLifecycle | null> {
  const source = configuredSource();
  if (!source) return null;
  if (!lifecycle) lifecycle = new CatalogLifecycle(source);
  if (!started) {
    if (!starting) {
      starting = lifecycle
        .start()
        .then(() => {
          started = true;
          const interval = Number(process.env["CATALOG_REFRESH_INTERVAL_MS"] ?? "30000");
          if (Number.isSafeInteger(interval) && interval > 0 && !refreshTimer) {
            refreshTimer = setInterval(() => void lifecycle?.refresh(), interval);
            refreshTimer.unref?.();
          }
        })
        .finally(() => {
          starting = null;
        });
    }
    await starting;
  }
  return lifecycle;
}

/** The exact immutable SQLite URL currently backing both queries and STAC. */
export async function activeCatalogStacUrl(): Promise<string | null> {
  if (!env.CATALOG_RELEASE_POINTER_URL) return env.CATALOG_SQLITE_URL ?? null;
  const active = await activeCatalogLifecycle();
  return active?.activeUrl() ?? null;
}

export async function catalogRuntimeHealth(): Promise<{
  ready: boolean;
  generation: string | null;
  last_successful_refresh: string | null;
  last_error: string | null;
}> {
  try {
    const active = await activeCatalogLifecycle();
    if (!active) return { ready: true, generation: null, last_successful_refresh: null, last_error: null };
    const status = active.status();
    return {
      ready: status.generation !== null,
      generation: status.generation,
      last_successful_refresh: status.lastSuccessfulRefresh,
      last_error: status.lastError,
    };
  } catch (error) {
    return {
      ready: false,
      generation: null,
      last_successful_refresh: null,
      last_error: error instanceof Error ? error.message : String(error),
    };
  }
}
