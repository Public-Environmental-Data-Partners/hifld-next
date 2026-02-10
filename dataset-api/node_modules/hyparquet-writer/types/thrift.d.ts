/**
 * Serialize a JS object in TCompactProtocol format.
 *
 * Expects keys named like "field_1", "field_2", etc. in ascending order.
 *
 * @import {ThriftType} from 'hyparquet/src/types.js'
 * @import {Writer} from '../src/types.js'
 * @param {Writer} writer
 * @param {Record<string, any>} data
 */
export function serializeTCompactProtocol(writer: Writer, data: Record<string, any>): void;
import type { Writer } from '../src/types.js';
//# sourceMappingURL=thrift.d.ts.map