/**
 * @import {Writer} from '../src/types.js'
 * @param {Writer} writer
 * @param {DecodedArray} values
 * @param {SchemaElement[]} schemaPath
 * @param {import('hyparquet').Encoding} encoding
 * @param {boolean} compressed
 */
export function writeDataPageV2(writer: Writer, values: DecodedArray, schemaPath: SchemaElement[], encoding: import("hyparquet").Encoding, compressed: boolean): void;
/**
 * @param {Writer} writer
 * @param {PageHeader} header
 */
export function writePageHeader(writer: Writer, header: PageHeader): void;
import type { Writer } from '../src/types.js';
import type { DecodedArray } from 'hyparquet';
import type { SchemaElement } from 'hyparquet';
import type { PageHeader } from 'hyparquet';
//# sourceMappingURL=datapage.d.ts.map