import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Dataset types enum for reference
export const datasetTypes = ["Point", "Polygon", "LineString", "MultiPolygon", "MultiPoint", "MultiLineString"] as const;
export type DatasetType = typeof datasetTypes[number];

// Dataset statuses for processing pipeline
export const datasetStatuses = ["pending", "processing", "ready", "error"] as const;
export type DatasetStatus = typeof datasetStatuses[number];

// Datasets catalog table
export const datasetsTable = sqliteTable("datasets", {
  id: int().primaryKey({ autoIncrement: true }),
  // Core identification
  name: text().notNull().unique(), // e.g. "security-zones-securityzones"
  alias: text().notNull(),         // e.g. "Security Zones - SecurityZones"
  description: text(),
  
  // Dataset type (geometry type)
  type: text().notNull(),          // Point, Polygon, LineString, etc.
  
  // Source URLs (from inventory)
  sourceParquetUrl: text(),        // gs:// URL from inventory
  sourceTilejsonUrl: text(),       // Original tilejson URL from inventory
  
  // Hosted URLs (our infrastructure)
  pmtilesUrl: text(),              // URL to our hosted PMTiles
  geoparquetUrl: text(),           // URL to our hosted GeoParquet
  featureUrl: text(),              // GeoServer OGC Feature API URL
  
  // GeoServer integration
  geoserverWorkspace: text(),      // e.g. "hifld"
  geoserverStore: text(),          // e.g. "security-zones"
  geoserverLayer: text(),          // e.g. "securityzones"
  
  // Processing status
  status: text().notNull().default("pending"), // pending, processing, ready, error
  errorMessage: text(),
  
  // Metadata
  featureCount: int(),
  bounds: text(),                  // JSON stringified bounding box
  
  // Timestamps
  createdAt: text().notNull().default(new Date().toISOString()),
  updatedAt: text().notNull().default(new Date().toISOString()),
  processedAt: text(),
});

// Type inference helpers
export type Dataset = typeof datasetsTable.$inferSelect;
export type NewDataset = typeof datasetsTable.$inferInsert;
