/**
 * Wraps parquetRead with filter and orderBy support.
 * This is a parquet-aware query engine that can read a subset of rows and columns.
 * Accepts optional filter object to filter the results and orderBy column name to sort the results.
 * Note that using orderBy may SIGNIFICANTLY increase the query time.
 *
 * @param {ParquetReadOptions & { filter?: ParquetQueryFilter, orderBy?: string }} options
 * @returns {Promise<Record<string, any>[]>} resolves when all requested rows and columns are parsed
 */
export function parquetQuery(options: ParquetReadOptions & {
    filter?: ParquetQueryFilter;
    orderBy?: string;
}): Promise<Record<string, any>[]>;
/**
 * Match a record against a query filter
 *
 * @param {any} record
 * @param {ParquetQueryFilter} query
 * @returns {boolean}
 * @example matchQuery({ id: 1 }, { id: {$gte: 1} }) // true
 */
export function matchQuery(record: any, query?: ParquetQueryFilter): boolean;
import type { ParquetReadOptions } from '../src/types.d.ts';
import type { ParquetQueryFilter } from '../src/types.d.ts';
//# sourceMappingURL=query.d.ts.map