/**
 * Infer a schema from column data.
 * Accepts optional schemaOverrides to override the type of columns by name.
 *
 * @param {object} options
 * @param {ColumnSource[]} options.columnData
 * @param {Record<string,SchemaElement>} [options.schemaOverrides]
 * @returns {SchemaElement[]}
 */
export function schemaFromColumnData({ columnData, schemaOverrides }: {
    columnData: ColumnSource[];
    schemaOverrides?: Record<string, import("hyparquet/src/types.js").SchemaElement> | undefined;
}): SchemaElement[];
/**
 * Automatically determine a SchemaElement from an array of values.
 *
 * @param {string} name
 * @param {DecodedArray} values
 * @returns {SchemaElement}
 */
export function autoSchemaElement(name: string, values: DecodedArray): SchemaElement;
/**
 * Get the max repetition level for a given schema path.
 *
 * @param {SchemaElement[]} schemaPath
 * @returns {number} max repetition level
 */
export function getMaxRepetitionLevel(schemaPath: SchemaElement[]): number;
/**
 * Get the max definition level for a given schema path.
 *
 * @param {SchemaElement[]} schemaPath
 * @returns {number} max definition level
 */
export function getMaxDefinitionLevel(schemaPath: SchemaElement[]): number;
import type { ColumnSource } from '../src/types.js';
import type { SchemaElement } from 'hyparquet';
import type { DecodedArray } from 'hyparquet';
//# sourceMappingURL=schema.d.ts.map