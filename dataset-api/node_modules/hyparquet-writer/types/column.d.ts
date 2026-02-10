/**
 * @param {Writer} writer
 * @param {SchemaElement[]} schemaPath
 * @param {DecodedArray} values
 * @param {boolean} compressed
 * @param {boolean} stats
 * @returns {ColumnMetaData}
 */
export function writeColumn(writer: Writer, schemaPath: SchemaElement[], values: DecodedArray, compressed: boolean, stats: boolean): ColumnMetaData;
import type { Writer } from '../src/types.js';
import type { SchemaElement } from 'hyparquet';
import type { DecodedArray } from 'hyparquet';
import type { ColumnMetaData } from 'hyparquet';
//# sourceMappingURL=column.d.ts.map