/**
 * @import {AsyncBuffer, AsyncRowGroup, DecodedArray, FileMetaData, ParquetReadOptions} from '../src/types.js'
 */
/**
 * Read parquet data rows from a file-like object.
 * Reads the minimal number of row groups and columns to satisfy the request.
 *
 * Returns a void promise when complete.
 * Errors are thrown on the returned promise.
 * Data is returned in callbacks onComplete, onChunk, onPage, NOT the return promise.
 * See parquetReadObjects for a more convenient API.
 *
 * @param {ParquetReadOptions} options read options
 * @returns {Promise<void>} resolves when all requested rows and columns are parsed, all errors are thrown here
 */
export function parquetRead(options: ParquetReadOptions): Promise<void>;
/**
 * @param {ParquetReadOptions} options read options
 * @returns {AsyncRowGroup[]}
 */
export function parquetReadAsync(options: ParquetReadOptions): AsyncRowGroup[];
/**
 * Reads a single column from a parquet file.
 *
 * @param {ParquetReadOptions} options
 * @returns {Promise<DecodedArray>}
 */
export function parquetReadColumn(options: ParquetReadOptions): Promise<DecodedArray>;
import type { ParquetReadOptions } from '../src/types.js';
import type { AsyncRowGroup } from '../src/types.js';
import type { DecodedArray } from '../src/types.js';
//# sourceMappingURL=read.d.ts.map