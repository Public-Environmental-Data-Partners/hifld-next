/**
 * Convert from rich to primitive types.
 *
 * @import {DecodedArray, SchemaElement, Statistics} from 'hyparquet'
 * @param {SchemaElement} element
 * @param {DecodedArray} values
 * @returns {DecodedArray}
 */
export function unconvert(element: SchemaElement, values: DecodedArray): DecodedArray;
/**
 * Uncovert from rich type to byte array for metadata statistics.
 *
 * @param {import('hyparquet/src/types.js').MinMaxType | undefined} value
 * @param {SchemaElement} element
 * @returns {Uint8Array | undefined}
 */
export function unconvertMinMax(value: import("hyparquet/src/types.js").MinMaxType | undefined, element: SchemaElement): Uint8Array | undefined;
/**
 * @param {Statistics} stats
 * @param {SchemaElement} element
 * @returns {import('../src/types.js').ThriftObject}
 */
export function unconvertStatistics(stats: Statistics, element: SchemaElement): import("../src/types.js").ThriftObject;
/**
 * @param {SchemaElement} element
 * @param {bigint} value
 * @returns {number | bigint | Uint8Array}
 */
export function unconvertDecimal({ type, type_length }: SchemaElement, value: bigint): number | bigint | Uint8Array;
/**
 * @param {number | undefined} value
 * @returns {Uint8Array | undefined}
 */
export function unconvertFloat16(value: number | undefined): Uint8Array | undefined;
import type { SchemaElement } from 'hyparquet';
import type { DecodedArray } from 'hyparquet';
import type { Statistics } from 'hyparquet';
//# sourceMappingURL=unconvert.d.ts.map