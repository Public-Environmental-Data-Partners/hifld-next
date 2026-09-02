import { compareVersionValues } from "@/components/dataset/versionLabel";
import {
  type CatalogSelectedMapFeature,
  isCatalogSelectedMapFeature,
  type SelectedMapFeature,
} from "./featureSelection";
import { s2CellForPoint } from "./featureSpatialIndex";

export const GEOMETRY_MATCH_COLUMN = "__geometry__";

const DEFAULT_MATCH_THRESHOLD = 0.65;
const STABLE_IDENTIFIER_FIELDS = ["OBJECTID", "ID", "id", "objectid", "fid", "facility_id"];
const DEFAULT_MATCH_KEY_FIELDS = [...STABLE_IDENTIFIER_FIELDS, "NAME", "name"];
interface FeatureDiffStatusOrder {
  changed: number;
  "possible match": number;
  "left only": number;
  "right only": number;
  unchanged: number;
}

const STATUS_SORT_ORDER: FeatureDiffStatusOrder = {
  changed: 0,
  "possible match": 1,
  "left only": 2,
  "right only": 3,
  unchanged: 4,
};

export type FeatureDiffStatus = "unchanged" | "changed" | "left only" | "right only" | "possible match";
export type FeatureMatchMethod = "key" | "fuzzy" | "s2" | "none";
export type FeatureDiffCellStatus = "unchanged" | "changed" | "added" | "removed";
export type FeatureDiffSortDirection = "asc" | "desc";

export interface FeatureDiffMatchKeyPair {
  id: string;
  left: string;
  right: string;
}

export interface FeatureDiffSort {
  column: string;
  direction: FeatureDiffSortDirection;
}

export interface FeatureDiffOptions {
  leftVersion: string;
  rightVersion: string;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  s2Level: number;
  sort?: FeatureDiffSort | undefined;
}

export interface FeatureDiffColumn {
  key: string;
  label: string;
}

export interface FeatureDiffCell {
  left: string;
  right: string;
  leftPresent: boolean;
  rightPresent: boolean;
  status: FeatureDiffCellStatus;
}

export interface FeatureDiffCells {
  [columnKey: string]: FeatureDiffCell;
}

export interface FeatureDiffRow {
  id: string;
  status: FeatureDiffStatus;
  matchMethod: FeatureMatchMethod;
  confidence: number;
  left: SelectedMapFeature | null;
  right: SelectedMapFeature | null;
  cells: FeatureDiffCells;
}

export interface FeatureDiffSummary {
  selected: number;
  matched: number;
  changed: number;
  leftOnly: number;
  rightOnly: number;
  possibleMatches: number;
}

export interface FeatureDiffResult {
  canCompare: boolean;
  reason?: string | undefined;
  leftVersion?: string | undefined;
  rightVersion?: string | undefined;
  columns: FeatureDiffColumn[];
  rows: FeatureDiffRow[];
  summary: FeatureDiffSummary;
}

interface CandidateScore {
  score: number;
  method: "key" | "fuzzy" | "s2";
}

interface ColumnScore {
  score: number;
  method: "key" | "fuzzy" | "s2";
  weight: number;
  isStableIdentifier: boolean;
}

interface CandidateScoreAccumulator {
  totalWeight: number;
  weightedScore: number;
  hasStableIdentifierExactMatch: boolean;
  hasStableIdentifierDisagreement: boolean;
  scores: ColumnScore[];
}

function emptySummary(selected: number): FeatureDiffSummary {
  return {
    selected,
    matched: 0,
    changed: 0,
    leftOnly: 0,
    rightOnly: 0,
    possibleMatches: 0,
  };
}

function catalogFeatures(features: SelectedMapFeature[]): CatalogSelectedMapFeature[] {
  return features.filter(isCatalogSelectedMapFeature);
}

function comparisonScope(feature: CatalogSelectedMapFeature): string {
  return [feature.collectionSlug, feature.datasetSlug, feature.fileSlug].join(":");
}

function comparableVersions(features: SelectedMapFeature[]): string[] | null {
  const catalog = catalogFeatures(features);
  if (catalog.length === 0 || catalog.length !== features.length) {
    return null;
  }
  const scopes = new Set(catalog.map(comparisonScope));
  const versions = new Set(catalog.map((feature) => feature.version));
  if (scopes.size !== 1 || versions.size !== 2) {
    return null;
  }
  return [...versions].sort((left, right) => compareVersionValues(right, left));
}

export function comparableFeatureDiffVersions(features: SelectedMapFeature[]): string[] {
  return comparableVersions(features) ?? [];
}

export function isComparableFeatureDiffSelection(features: SelectedMapFeature[]): boolean {
  return comparableVersions(features) !== null;
}

function allPropertyKeys(features: SelectedMapFeature[]): string[] {
  return [...new Set(features.flatMap((feature) => Object.keys(feature.properties)))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function propertyKeysForVersion(features: SelectedMapFeature[], version: string): Set<string> {
  const catalog = catalogFeatures(features);
  return new Set(
    catalog.filter((feature) => feature.version === version).flatMap((feature) => Object.keys(feature.properties)),
  );
}

function featuresForVersionHaveCentroid(features: SelectedMapFeature[], version: string): boolean {
  return catalogFeatures(features).some((feature) => feature.version === version && feature.centroid !== null);
}

function matchKeyPair(left: string, right: string): FeatureDiffMatchKeyPair {
  return { id: `${left}:${right}`, left, right };
}

export function featureDiffMatchKeyOptions(features: SelectedMapFeature[], version: string): FeatureDiffColumn[] {
  const catalog = catalogFeatures(features);
  const propertyColumns = [...propertyKeysForVersion(features, version)]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({ key, label: key }));
  if (!featuresForVersionHaveCentroid(catalog, version)) {
    return propertyColumns;
  }
  return [...propertyColumns, { key: GEOMETRY_MATCH_COLUMN, label: "Geometry" }];
}

export function defaultFeatureDiffMatchKeyPairs(
  features: SelectedMapFeature[],
  leftVersion: string,
  rightVersion: string,
): FeatureDiffMatchKeyPair[] {
  const catalog = catalogFeatures(features);
  const leftPropertyKeys = propertyKeysForVersion(catalog, leftVersion);
  const rightPropertyKeys = propertyKeysForVersion(catalog, rightVersion);
  for (const key of DEFAULT_MATCH_KEY_FIELDS) {
    if (leftPropertyKeys.has(key) && rightPropertyKeys.has(key)) {
      return [matchKeyPair(key, key)];
    }
  }
  const commonKeys = [...leftPropertyKeys]
    .filter((key) => rightPropertyKeys.has(key))
    .sort((left, right) => left.localeCompare(right));
  if (commonKeys.length > 0) {
    const [key] = commonKeys;
    return key ? [matchKeyPair(key, key)] : [];
  }
  if (featuresForVersionHaveCentroid(catalog, leftVersion) && featuresForVersionHaveCentroid(catalog, rightVersion)) {
    return [matchKeyPair(GEOMETRY_MATCH_COLUMN, GEOMETRY_MATCH_COLUMN)];
  }
  return [];
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): Set<string> {
  if (value.length <= 2) {
    return new Set(value ? [value] : []);
  }
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

function textSimilarity(leftValue: string, rightValue: string): number | null {
  const left = normalizeText(leftValue);
  const right = normalizeText(rightValue);
  if (!left || !right) {
    return null;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    return Math.max(0.7, shorter / longer);
  }
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) {
    return null;
  }
  let intersection = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function hasFeatureProperty(feature: SelectedMapFeature, key: string): boolean {
  return Object.hasOwn(feature.properties, key);
}

function isStableIdentifierKey(key: string): boolean {
  return STABLE_IDENTIFIER_FIELDS.includes(key);
}

function matchKeyWeight(isStableIdentifier: boolean): number {
  return isStableIdentifier ? 2.5 : 1;
}

function scoreGeometryColumn({
  left,
  right,
  s2Level,
  geometryOnly,
}: {
  left: CatalogSelectedMapFeature;
  right: CatalogSelectedMapFeature;
  s2Level: number;
  geometryOnly: boolean;
}): ColumnScore | null {
  const score = geometrySimilarity(left, right, s2Level);
  return score === null ? null : { score, method: "s2", weight: geometryOnly ? 1 : 0.7, isStableIdentifier: false };
}

function scorePropertyColumn({
  pair,
  left,
  right,
}: {
  pair: FeatureDiffMatchKeyPair;
  left: CatalogSelectedMapFeature;
  right: CatalogSelectedMapFeature;
}): ColumnScore | null {
  const isStableIdentifier = isStableIdentifierKey(pair.left) && isStableIdentifierKey(pair.right);
  const weight = matchKeyWeight(isStableIdentifier);
  const leftPresent = hasFeatureProperty(left, pair.left);
  const rightPresent = hasFeatureProperty(right, pair.right);
  if (!leftPresent || !rightPresent) {
    return { score: 0, method: "fuzzy", weight, isStableIdentifier };
  }
  const leftValue = left.properties[pair.left] ?? "";
  const rightValue = right.properties[pair.right] ?? "";
  const leftNormalized = normalizeText(leftValue);
  const rightNormalized = normalizeText(rightValue);
  if (isStableIdentifier && leftNormalized && rightNormalized && leftNormalized !== rightNormalized) {
    return { score: 0, method: "key", weight, isStableIdentifier };
  }
  const score = textSimilarity(leftValue, rightValue);
  if (score === null) {
    return null;
  }
  return {
    score,
    method: score === 1 || isStableIdentifier ? "key" : "fuzzy",
    weight,
    isStableIdentifier,
  };
}

function geometrySimilarity(
  left: CatalogSelectedMapFeature,
  right: CatalogSelectedMapFeature,
  s2Level: number,
): number | null {
  if (!left.centroid || !right.centroid) {
    return null;
  }
  const leftCell = s2CellForPoint(left.centroid, s2Level);
  const rightCell = s2CellForPoint(right.centroid, s2Level);
  if (leftCell.token === rightCell.token) {
    return 0.8;
  }
  if (leftCell.neighbors.includes(rightCell.token)) {
    return 0.7;
  }
  return 0;
}

function scoreForColumn({
  pair,
  left,
  right,
  s2Level,
  geometryOnly,
}: {
  pair: FeatureDiffMatchKeyPair;
  left: CatalogSelectedMapFeature;
  right: CatalogSelectedMapFeature;
  s2Level: number;
  geometryOnly: boolean;
}): ColumnScore | null {
  if (pair.left === GEOMETRY_MATCH_COLUMN && pair.right === GEOMETRY_MATCH_COLUMN) {
    return scoreGeometryColumn({ left, right, s2Level, geometryOnly });
  }
  if (pair.left === GEOMETRY_MATCH_COLUMN || pair.right === GEOMETRY_MATCH_COLUMN) {
    return null;
  }
  return scorePropertyColumn({ pair, left, right });
}

function emptyCandidateScoreAccumulator(): CandidateScoreAccumulator {
  return {
    totalWeight: 0,
    weightedScore: 0,
    hasStableIdentifierExactMatch: false,
    hasStableIdentifierDisagreement: false,
    scores: [],
  };
}

function addColumnScore(accumulator: CandidateScoreAccumulator, score: ColumnScore): CandidateScoreAccumulator {
  return {
    totalWeight: accumulator.totalWeight + score.weight,
    weightedScore: accumulator.weightedScore + score.score * score.weight,
    hasStableIdentifierExactMatch:
      accumulator.hasStableIdentifierExactMatch || (score.isStableIdentifier && score.score === 1),
    hasStableIdentifierDisagreement:
      accumulator.hasStableIdentifierDisagreement || (score.isStableIdentifier && score.score < 1),
    scores: [...accumulator.scores, score],
  };
}

function bestColumnSignal(scores: ColumnScore[]): ColumnScore | null {
  let bestSignal = scores[0];
  if (!bestSignal) {
    return null;
  }
  for (const score of scores.slice(1)) {
    if (score.score > bestSignal.score) {
      bestSignal = score;
    }
  }
  return bestSignal;
}

function candidateScoreFromAccumulator(accumulator: CandidateScoreAccumulator): CandidateScore | null {
  if (accumulator.totalWeight === 0 || accumulator.scores.length === 0 || accumulator.hasStableIdentifierDisagreement) {
    return null;
  }
  const aggregateScore = accumulator.weightedScore / accumulator.totalWeight;
  if (aggregateScore < DEFAULT_MATCH_THRESHOLD) {
    return null;
  }
  if (accumulator.hasStableIdentifierExactMatch) {
    return { score: aggregateScore, method: "key" };
  }
  const bestSignal = bestColumnSignal(accumulator.scores);
  return bestSignal ? { score: aggregateScore, method: bestSignal.method } : null;
}

function scoreCandidate({
  left,
  right,
  matchKeyPairs,
  s2Level,
}: {
  left: CatalogSelectedMapFeature;
  right: CatalogSelectedMapFeature;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  s2Level: number;
}): CandidateScore | null {
  let accumulator = emptyCandidateScoreAccumulator();
  const geometryOnly =
    matchKeyPairs.length === 1 &&
    matchKeyPairs[0]?.left === GEOMETRY_MATCH_COLUMN &&
    matchKeyPairs[0]?.right === GEOMETRY_MATCH_COLUMN;

  for (const pair of matchKeyPairs) {
    const score = scoreForColumn({ pair, left, right, s2Level, geometryOnly });
    if (score === null) {
      continue;
    }
    accumulator = addColumnScore(accumulator, score);
  }
  return candidateScoreFromAccumulator(accumulator);
}

function cellStatus({
  left,
  right,
  leftPresent,
  rightPresent,
}: {
  left: string;
  right: string;
  leftPresent: boolean;
  rightPresent: boolean;
}): FeatureDiffCellStatus {
  if (!leftPresent && !rightPresent) {
    return "unchanged";
  }
  if (!leftPresent && rightPresent) {
    return "added";
  }
  if (leftPresent && !rightPresent) {
    return "removed";
  }
  if (left === right) {
    return "unchanged";
  }
  return "changed";
}

function buildCells(
  left: CatalogSelectedMapFeature | null,
  right: CatalogSelectedMapFeature | null,
  columns: FeatureDiffColumn[],
) {
  const cells: FeatureDiffCells = {};
  for (const column of columns) {
    const leftPresent = left ? hasFeatureProperty(left, column.key) : false;
    const rightPresent = right ? hasFeatureProperty(right, column.key) : false;
    const leftValue = leftPresent ? (left?.properties[column.key] ?? "") : "";
    const rightValue = rightPresent ? (right?.properties[column.key] ?? "") : "";
    cells[column.key] = {
      left: leftValue,
      right: rightValue,
      leftPresent,
      rightPresent,
      status: cellStatus({ left: leftValue, right: rightValue, leftPresent, rightPresent }),
    };
  }
  return cells;
}

function rowStatus({
  left,
  right,
  confidence,
  cells,
}: {
  left: CatalogSelectedMapFeature | null;
  right: CatalogSelectedMapFeature | null;
  confidence: number;
  cells: FeatureDiffCells;
}): FeatureDiffStatus {
  if (!left) {
    return "right only";
  }
  if (!right) {
    return "left only";
  }
  if (confidence < 0.9) {
    return "possible match";
  }
  return Object.values(cells).some((cell) => cell.status !== "unchanged") ? "changed" : "unchanged";
}

function matchedRow({
  left,
  right,
  score,
  method,
  columns,
}: {
  left: CatalogSelectedMapFeature;
  right: CatalogSelectedMapFeature;
  score: number;
  method: FeatureMatchMethod;
  columns: FeatureDiffColumn[];
}): FeatureDiffRow {
  const cells = buildCells(left, right, columns);
  return {
    id: `${left.id}:${right.id}`,
    status: rowStatus({ left, right, confidence: score, cells }),
    matchMethod: method,
    confidence: score,
    left,
    right,
    cells,
  };
}

function unmatchedRow(
  feature: CatalogSelectedMapFeature,
  side: "left" | "right",
  columns: FeatureDiffColumn[],
): FeatureDiffRow {
  const left = side === "left" ? feature : null;
  const right = side === "right" ? feature : null;
  return {
    id: `${side}:${feature.id}`,
    status: side === "left" ? "left only" : "right only",
    matchMethod: "none",
    confidence: 0,
    left,
    right,
    cells: buildCells(left, right, columns),
  };
}

function summarize(rows: FeatureDiffRow[], selected: number): FeatureDiffSummary {
  return {
    selected,
    matched: rows.filter((row) => row.left && row.right).length,
    changed: rows.filter((row) => row.status === "changed").length,
    leftOnly: rows.filter((row) => row.status === "left only").length,
    rightOnly: rows.filter((row) => row.status === "right only").length,
    possibleMatches: rows.filter((row) => row.status === "possible match").length,
  };
}

function featureSortValue(row: FeatureDiffRow, column: string): string {
  const cell = row.cells[column];
  if (!cell) {
    return "";
  }
  if (cell.leftPresent) {
    return cell.left;
  }
  if (cell.rightPresent) {
    return cell.right;
  }
  return "";
}

function sortRows(rows: FeatureDiffRow[], sort: FeatureDiffSort | undefined): FeatureDiffRow[] {
  if (!sort) {
    return rows;
  }
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.column === "status") {
      return (STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status]) * direction;
    }
    if (sort.column === "confidence") {
      return (left.confidence - right.confidence) * direction;
    }
    return (
      featureSortValue(left, sort.column).localeCompare(featureSortValue(right, sort.column), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction
    );
  });
}

function bestMatchForLeft({
  left,
  rightFeatures,
  unmatchedRight,
  matchKeyPairs,
  s2Level,
}: {
  left: CatalogSelectedMapFeature;
  rightFeatures: CatalogSelectedMapFeature[];
  unmatchedRight: Set<string>;
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  s2Level: number;
}): { right: CatalogSelectedMapFeature; score: CandidateScore } | null {
  let bestRight: CatalogSelectedMapFeature | null = null;
  let bestScore: CandidateScore | null = null;
  for (const right of rightFeatures) {
    if (!unmatchedRight.has(right.id)) {
      continue;
    }
    const score = scoreCandidate({ left, right, matchKeyPairs, s2Level });
    if (!score) {
      continue;
    }
    if (
      !bestScore ||
      score.score > bestScore.score ||
      (score.score === bestScore.score && scoreMethodRank(score.method) < scoreMethodRank(bestScore.method)) ||
      (score.score === bestScore.score &&
        score.method === bestScore.method &&
        right.id.localeCompare(bestRight?.id ?? "") < 0)
    ) {
      bestRight = right;
      bestScore = score;
    }
  }
  return bestRight && bestScore ? { right: bestRight, score: bestScore } : null;
}

function scoreMethodRank(method: FeatureMatchMethod): number {
  if (method === "key") {
    return 0;
  }
  if (method === "fuzzy") {
    return 1;
  }
  if (method === "s2") {
    return 2;
  }
  return 3;
}

function buildRows({
  leftFeatures,
  rightFeatures,
  matchKeyPairs,
  s2Level,
  columns,
}: {
  leftFeatures: CatalogSelectedMapFeature[];
  rightFeatures: CatalogSelectedMapFeature[];
  matchKeyPairs: FeatureDiffMatchKeyPair[];
  s2Level: number;
  columns: FeatureDiffColumn[];
}): FeatureDiffRow[] {
  const unmatchedRight = new Set(rightFeatures.map((feature) => feature.id));
  const rows: FeatureDiffRow[] = [];

  for (const left of leftFeatures) {
    const match = bestMatchForLeft({ left, rightFeatures, unmatchedRight, matchKeyPairs, s2Level });
    if (!match) {
      rows.push(unmatchedRow(left, "left", columns));
      continue;
    }
    unmatchedRight.delete(match.right.id);
    rows.push(matchedRow({ left, right: match.right, score: match.score.score, method: match.score.method, columns }));
  }

  for (const right of rightFeatures) {
    if (unmatchedRight.has(right.id)) {
      rows.push(unmatchedRow(right, "right", columns));
    }
  }

  return rows;
}

export function buildFeatureDiff(features: SelectedMapFeature[], options: FeatureDiffOptions): FeatureDiffResult {
  const catalog = catalogFeatures(features);
  const versions = comparableVersions(catalog);
  if (!versions || options.leftVersion === options.rightVersion) {
    return {
      canCompare: false,
      reason: "Select features from exactly two versions of the same dataset file.",
      columns: [],
      rows: [],
      summary: emptySummary(features.length),
    };
  }

  const leftVersion = versions.includes(options.leftVersion) ? options.leftVersion : versions[0];
  const rightVersion = versions.includes(options.rightVersion)
    ? options.rightVersion
    : versions.find((version) => version !== leftVersion);
  if (!leftVersion || !rightVersion || leftVersion === rightVersion) {
    return {
      canCompare: false,
      reason: "Choose two different versions to compare.",
      columns: [],
      rows: [],
      summary: emptySummary(features.length),
    };
  }
  const columns = allPropertyKeys(catalog).map((key) => ({ key, label: key }));
  const matchKeyPairs =
    options.matchKeyPairs.length > 0
      ? options.matchKeyPairs
      : defaultFeatureDiffMatchKeyPairs(catalog, leftVersion, rightVersion);
  const leftFeatures = catalog.filter((feature) => feature.version === leftVersion);
  const rightFeatures = catalog.filter((feature) => feature.version === rightVersion);
  const rows = buildRows({ leftFeatures, rightFeatures, matchKeyPairs, s2Level: options.s2Level, columns });
  const sortedRows = sortRows(rows, options.sort);

  return {
    canCompare: true,
    leftVersion,
    rightVersion,
    columns,
    rows: sortedRows,
    summary: summarize(sortedRows, features.length),
  };
}

export function changedFeatureDiffColumns(diff: FeatureDiffResult): FeatureDiffColumn[] {
  return diff.columns.filter((column) => diff.rows.some((row) => row.cells[column.key]?.status !== "unchanged"));
}
