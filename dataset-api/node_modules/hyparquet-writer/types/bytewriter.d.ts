/**
 * Generic buffered writer.
 * Writes data to an auto-expanding ArrayBuffer.
 *
 * @import {Writer} from '../src/types.js'
 * @returns {Writer}
 */
export function ByteWriter(): Writer;
export class ByteWriter {
    buffer: ArrayBuffer;
    view: DataView<ArrayBuffer>;
    offset: number;
    index: number;
    /**
     * @param {number} size
     */
    ensure(size: number): void;
    finish(): void;
    getBuffer(): ArrayBuffer;
    /**
     * @param {number} value
     */
    appendUint8(value: number): void;
    /**
     * @param {number} value
     */
    appendUint32(value: number): void;
    /**
     * @param {number} value
     */
    appendInt32(value: number): void;
    /**
     * @param {bigint} value
     */
    appendInt64(value: bigint): void;
    /**
     * @param {number} value
     */
    appendFloat32(value: number): void;
    /**
     * @param {number} value
     */
    appendFloat64(value: number): void;
    /**
     * @param {ArrayBuffer} value
     */
    appendBuffer(value: ArrayBuffer): void;
    /**
     * @param {Uint8Array} value
     */
    appendBytes(value: Uint8Array): void;
    /**
     * Convert a 32-bit signed integer to varint (1-5 bytes).
     * Writes out groups of 7 bits at a time, setting high bit if more to come.
     *
     * @param {number} value
     */
    appendVarInt(value: number): void;
    /**
     * Convert a bigint to varint (1-10 bytes for 64-bit range).
     *
     * @param {bigint} value
     */
    appendVarBigInt(value: bigint): void;
}
import type { Writer } from '../src/types.js';
//# sourceMappingURL=bytewriter.d.ts.map