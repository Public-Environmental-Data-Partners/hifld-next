/**
 * @import {DecodedArray} from 'hyparquet'
 * @import {Writer} from '../src/types.js'
 * @param {Writer} writer
 * @param {DecodedArray} values
 * @param {number} bitWidth
 * @returns {number} bytes written
 */
export function writeRleBitPackedHybrid(writer: Writer, values: DecodedArray, bitWidth: number): number;
import type { Writer } from '../src/types.js';
import type { DecodedArray } from 'hyparquet';
//# sourceMappingURL=encoding.d.ts.map