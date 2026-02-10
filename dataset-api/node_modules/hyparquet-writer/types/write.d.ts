/**
 * Write data as parquet to a file or stream.
 *
 * @import {ParquetWriteOptions} from '../src/types.js'
 * @param {ParquetWriteOptions} options
 */
export function parquetWrite({ writer, columnData, schema, compressed, statistics, rowGroupSize, kvMetadata, }: ParquetWriteOptions): void;
/**
 * Write data as parquet to an ArrayBuffer.
 *
 * @param {Omit<ParquetWriteOptions, 'writer'>} options
 * @returns {ArrayBuffer}
 */
export function parquetWriteBuffer(options: Omit<ParquetWriteOptions, "writer">): ArrayBuffer;
import type { ParquetWriteOptions } from '../src/types.js';
//# sourceMappingURL=write.d.ts.map