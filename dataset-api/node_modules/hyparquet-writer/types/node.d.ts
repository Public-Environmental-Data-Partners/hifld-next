/**
 * Write data as parquet to a local file.
 *
 * @import {ParquetWriteOptions, Writer} from '../src/types.js'
 * @param {Omit<ParquetWriteOptions, 'writer'> & {filename: string}} options
 */
export function parquetWriteFile(options: Omit<ParquetWriteOptions, "writer"> & {
    filename: string;
}): void;
/**
 * Buffered file writer.
 * Writes data to a local file in chunks using node fs.
 *
 * @param {string} filename
 * @returns {Writer}
 */
export function fileWriter(filename: string): Writer;
export * from "./index.js";
import type { ParquetWriteOptions } from '../src/types.js';
import type { Writer } from '../src/types.js';
//# sourceMappingURL=node.d.ts.map