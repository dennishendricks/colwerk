// DuckDB through its C API, as exposed 1:1 by the Node-API addon `@duckdb/node-bindings`. Results are read
// from the vectors' memory directly instead of through `@duckdb/node-api`'s value objects, to produce the
// unified value model (see `CellValue`) in one pass.
import { existsSync } from 'node:fs'
import type * as Bindings from '@duckdb/node-bindings'
import { AppError, type CellValue } from '../types.ts'
import { call, duckdb } from './duckdb-bindings.ts'
import { type Decoder, describe } from './duckdb-vectors.ts'

// One cache per access mode: switching a connection to read-only would otherwise collide with the
// read-write instance while it is still open.
// The sandbox of MCP clients has a cache of its own: its configuration differs.
const caches: {
  readWrite?: Bindings.InstanceCache
  readOnly?: Bindings.InstanceCache
  sandbox?: Bindings.InstanceCache
} = {}

// Files open for writing in this process, by path: a sandbox must not open them as a second instance
// (DuckDB does not support two instances on one file; POSIX locks do not separate them within a process).
const writers = new Map<string, number>()

/**
 * Opens a connection to the database at `path`. Every connection holds its own database handle from the
 * instance cache, so a file is opened only once per process and configuration.
 *
 * `sandbox` (MCP clients): the file opens read-only in an instance without access to files, URLs and extensions;
 * an in-memory database is an empty one of its own.
 */
export async function connect(
  path: string,
  readOnly: boolean,
  v1Storage: boolean,
  sandbox = false,
): Promise<Connection> {
  const d = duckdb()
  const memory = path.startsWith(':memory:')
  if (sandbox && !memory && writers.get(path)) {
    throw new AppError(
      'mcpDuckdbInUse',
      `Colwerk has ${path} open for writing; MCP can only read it in its sandbox when it is not. Disconnect the connection, open it read-only, or allow MCP access to files and URLs for it.`,
      { params: { file: path } },
    )
  }
  const ro = readOnly || (sandbox && !memory)
  if (v1Storage && !ro && !memory && !existsSync(path)) await createV1(path)
  const cache = sandbox
    ? (caches.sandbox ??= d.create_instance_cache())
    : ro
      ? (caches.readOnly ??= d.create_instance_cache())
      : (caches.readWrite ??= d.create_instance_cache())
  const config = d.create_config()
  if (ro) d.set_config(config, 'access_mode', 'READ_ONLY')
  if (sandbox) {
    d.set_config(config, 'enable_external_access', 'false')
    // A statement cannot switch it back.
    d.set_config(config, 'lock_configuration', 'true')
  }
  const db = await call(d.get_or_create_from_cache(cache, path, config))
  const writing = !ro && !memory
  if (writing) writers.set(path, (writers.get(path) ?? 0) + 1)
  const release = () => {
    if (!writing) return
    const n = writers.get(path)! - 1
    if (n) writers.set(path, n)
    else writers.delete(path)
  }
  try {
    return new Connection(db, await call(d.connect(db)), release)
  } catch (e) {
    release()
    d.close_sync(db)
    throw e
  }
}

/**
 * Creates the file in the storage format of DuckDB 1.4, which DuckDB 2 keeps when writing to it later. The
 * setting only applies when a file is created, so an instance outside the cache does it: the cache allows one
 * configuration per file.
 */
async function createV1(path: string) {
  const d = duckdb()
  const config = d.create_config()
  d.set_config(config, 'storage_compatibility_version', 'v1.4.0')
  d.close_sync(await call(d.open(path, config)))
}

export class Connection {
  private closed = false

  constructor(
    private db: Bindings.Database,
    private conn: Bindings.Connection,
    private onClose: () => void = () => {},
  ) {}

  /** Runs one statement; the result streams and must be closed. `params` are bound as VARCHAR. */
  async query(sql: string, params: string[] = []): Promise<Result> {
    const d = duckdb()
    const prepared = await call(d.prepare(this.conn, sql))
    try {
      params.forEach((p, i) => d.bind_varchar(prepared, i + 1, p))
      const result = await call(d.execute_prepared_streaming(prepared))
      // An open result blocks the connection (DuckDB 2.0), so it is destroyed if a column type is unsupported.
      try {
        return new Result(prepared, result)
      } catch (e) {
        d.destroy_result_sync(result)
        throw e
      }
    } catch (e) {
      d.destroy_prepare_sync(prepared)
      throw e
    }
  }

  /** Aborts the running statement; safe to call from another task while it runs. */
  interrupt() {
    duckdb().interrupt(this.conn)
  }

  /** Only once no statement runs anymore. Repeated calls are no-ops. */
  close() {
    if (this.closed) return
    this.closed = true
    duckdb().disconnect_sync(this.conn)
    duckdb().close_sync(this.db)
    this.onClose()
  }
}

const QUERY_RESULT = 3

export class Result {
  readonly columns: { name: string; type: string }[] = []
  private decoders: Decoder[] = []

  constructor(
    private prepared: Bindings.PreparedStatement,
    private result: Bindings.Result,
  ) {
    const d = duckdb()
    for (let i = 0; i < d.column_count(result); i++) {
      const { name, decode } = describe(d.column_logical_type(result, i))
      this.columns.push({ name: d.column_name(result, i), type: name })
      this.decoders.push(decode)
    }
  }

  /** False for DDL and DML, which only report a count. */
  get isQuery() {
    return duckdb().result_return_type(this.result) === QUERY_RESULT
  }

  get rowsChanged() {
    return Number(duckdb().rows_changed(this.result))
  }

  /** The next chunk of rows (up to 2048), undefined at the end. */
  async next(): Promise<CellValue[][] | undefined> {
    const d = duckdb()
    const chunk = await call(d.fetch_chunk(this.result))
    const count = chunk ? d.data_chunk_get_size(chunk) : 0
    if (!count) return undefined
    const columns = this.decoders.map((decode, i) => decode(d.data_chunk_get_vector(chunk!, i), count))
    return Array.from({ length: count }, (_, row) => columns.map((read) => read(row)))
  }

  close() {
    duckdb().destroy_result_sync(this.result)
    duckdb().destroy_prepare_sync(this.prepared)
  }
}
