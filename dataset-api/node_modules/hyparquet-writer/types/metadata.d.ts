/**
 * @import {FileMetaData, LogicalType, TimeUnit} from 'hyparquet'
 * @import {ThriftObject, Writer} from '../src/types.js'
 * @param {Writer} writer
 * @param {FileMetaData} metadata
 */
export function writeMetadata(writer: Writer, metadata: FileMetaData): void;
/**
 * @param {LogicalType | undefined} type
 * @returns {ThriftObject | undefined}
 */
export function logicalType(type: LogicalType | undefined): ThriftObject | undefined;
import type { Writer } from '../src/types.js';
import type { FileMetaData } from 'hyparquet';
import type { LogicalType } from 'hyparquet';
import type { ThriftObject } from '../src/types.js';
//# sourceMappingURL=metadata.d.ts.map