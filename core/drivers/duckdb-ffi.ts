// DuckDB through its C API (Deno FFI) instead of the Node-API addon of @duckdb/node-api: `deno desktop`
// binaries do not export the N-API symbols from their executable, so the addon crashes the app on Windows
// and Linux (denoland/deno#36596). This is the only part of core/ that depends on Deno.
//
// The library is `libduckdb` from the npm package `@duckdb/node-bindings-<platform>`: in packaged builds the
// launcher downloads it and passes its path through globalThis (launcher/native.ts), from source it comes
// from the project's node_modules.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
// Named imports: Nitro's Deno preset adds its own `process` import to every chunk.
import { arch, cwd, platform } from 'node:process'
import { type CellValue, DbError } from '../types.ts'
import { toHex } from '../values.ts'

const LIBRARY: Record<string, string> = { darwin: 'libduckdb.dylib', linux: 'libduckdb.so', win32: 'duckdb.dll' }

function libraryPath(): string {
  const path = (globalThis as { dbmDuckdbLibrary?: string }).dbmDuckdbLibrary
  if (path) return path
  // Resolved from the working directory (dev server and tests run in the project root), since Nitro's bundles
  // do not keep `import.meta.url`.
  const bindings = createRequire(join(cwd(), 'package.json')).resolve('@duckdb/node-bindings/package.json')
  const pkg = createRequire(bindings).resolve(`@duckdb/node-bindings-${platform}-${arch}/package.json`)
  return join(dirname(pkg), LIBRARY[platform]!)
}

// `duckdb_result` is passed by value to some functions: six 8-byte fields.
const RESULT = { struct: ['u64', 'u64', 'u64', 'pointer', 'pointer', 'pointer'] } as const

// Out parameters and `T *` arguments are buffers; calls that can run long are nonblocking (own thread),
// so the event loop keeps running and `duckdb_interrupt` can reach them.
const SYMBOLS = {
  duckdb_create_instance_cache: { parameters: [], result: 'pointer' },
  duckdb_get_or_create_from_cache: { parameters: ['pointer', 'buffer', 'buffer', 'pointer', 'buffer'], result: 'i32', nonblocking: true },
  duckdb_create_config: { parameters: ['buffer'], result: 'i32' },
  duckdb_set_config: { parameters: ['pointer', 'buffer', 'buffer'], result: 'i32' },
  duckdb_destroy_config: { parameters: ['buffer'], result: 'void' },
  duckdb_close: { parameters: ['buffer'], result: 'void' },
  duckdb_connect: { parameters: ['pointer', 'buffer'], result: 'i32' },
  duckdb_disconnect: { parameters: ['buffer'], result: 'void' },
  duckdb_interrupt: { parameters: ['pointer'], result: 'void' },
  duckdb_free: { parameters: ['pointer'], result: 'void' },
  duckdb_prepare: { parameters: ['pointer', 'buffer', 'buffer'], result: 'i32', nonblocking: true },
  duckdb_prepare_error: { parameters: ['pointer'], result: 'pointer' },
  duckdb_bind_varchar: { parameters: ['pointer', 'u64', 'buffer'], result: 'i32' },
  duckdb_destroy_prepare: { parameters: ['buffer'], result: 'void' },
  duckdb_execute_prepared_streaming: { parameters: ['pointer', 'buffer'], result: 'i32', nonblocking: true },
  duckdb_result_error: { parameters: ['buffer'], result: 'pointer' },
  duckdb_result_return_type: { parameters: [RESULT], result: 'i32' },
  duckdb_rows_changed: { parameters: ['buffer'], result: 'u64' },
  duckdb_column_count: { parameters: ['buffer'], result: 'u64' },
  duckdb_column_name: { parameters: ['buffer', 'u64'], result: 'pointer' },
  duckdb_column_logical_type: { parameters: ['buffer', 'u64'], result: 'pointer' },
  duckdb_fetch_chunk: { parameters: [RESULT], result: 'pointer', nonblocking: true },
  duckdb_destroy_result: { parameters: ['buffer'], result: 'void' },
  duckdb_data_chunk_get_size: { parameters: ['pointer'], result: 'u64' },
  duckdb_data_chunk_get_vector: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_destroy_data_chunk: { parameters: ['buffer'], result: 'void' },
  duckdb_vector_get_data: { parameters: ['pointer'], result: 'pointer' },
  duckdb_vector_get_validity: { parameters: ['pointer'], result: 'pointer' },
  duckdb_list_vector_get_child: { parameters: ['pointer'], result: 'pointer' },
  duckdb_list_vector_get_size: { parameters: ['pointer'], result: 'u64' },
  duckdb_array_vector_get_child: { parameters: ['pointer'], result: 'pointer' },
  duckdb_struct_vector_get_child: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_get_type_id: { parameters: ['pointer'], result: 'i32' },
  duckdb_logical_type_get_alias: { parameters: ['pointer'], result: 'pointer' },
  duckdb_destroy_logical_type: { parameters: ['buffer'], result: 'void' },
  duckdb_decimal_width: { parameters: ['pointer'], result: 'u8' },
  duckdb_decimal_scale: { parameters: ['pointer'], result: 'u8' },
  duckdb_decimal_internal_type: { parameters: ['pointer'], result: 'i32' },
  duckdb_enum_internal_type: { parameters: ['pointer'], result: 'i32' },
  duckdb_enum_dictionary_size: { parameters: ['pointer'], result: 'u32' },
  duckdb_enum_dictionary_value: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_list_type_child_type: { parameters: ['pointer'], result: 'pointer' },
  duckdb_array_type_child_type: { parameters: ['pointer'], result: 'pointer' },
  duckdb_array_type_array_size: { parameters: ['pointer'], result: 'u64' },
  duckdb_map_type_key_type: { parameters: ['pointer'], result: 'pointer' },
  duckdb_map_type_value_type: { parameters: ['pointer'], result: 'pointer' },
  duckdb_struct_type_child_count: { parameters: ['pointer'], result: 'u64' },
  duckdb_struct_type_child_name: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_struct_type_child_type: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_union_type_member_count: { parameters: ['pointer'], result: 'u64' },
  duckdb_union_type_member_name: { parameters: ['pointer', 'u64'], result: 'pointer' },
  duckdb_union_type_member_type: { parameters: ['pointer', 'u64'], result: 'pointer' },
} as const

// core/ is also type-checked by Nuxt, which does not know Deno's types, so the FFI API used here is typed locally.
type Pointer = object | null
type Param<T> = T extends 'pointer' ? Pointer : T extends 'u64' ? bigint : T extends 'buffer' ? ArrayBufferView : Uint8Array
type Return<T> = T extends 'pointer' ? Pointer : T extends 'void' ? undefined : T extends 'u64' ? number | bigint : number
type Params<P extends readonly unknown[]> = { -readonly [I in keyof P]: Param<P[I]> }
type Symbols = {
  [K in keyof typeof SYMBOLS]: (...args: Params<typeof SYMBOLS[K]['parameters']>) =>
  typeof SYMBOLS[K] extends { nonblocking: true } ? Promise<Return<typeof SYMBOLS[K]['result']>> : Return<typeof SYMBOLS[K]['result']>
}
const { Deno } = globalThis as unknown as {
  Deno: {
    dlopen(path: string, symbols: typeof SYMBOLS): { symbols: Symbols }
    UnsafePointer: { create(value: bigint): Pointer, value(p: Pointer): number | bigint }
    UnsafePointerView: { getCString(p: object): string, getArrayBuffer(p: object, byteLength: number): ArrayBuffer }
  }
}

let symbols: Symbols | undefined
const capi = () => symbols ??= Deno.dlopen(libraryPath(), SYMBOLS).symbols

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const cstr = (s: string) => encoder.encode(`${s}\0`)
const text = (p: Pointer) => p ? Deno.UnsafePointerView.getCString(p) : ''
/** A string the caller has to free. */
function owned(p: Pointer): string {
  try {
    return text(p)
  } finally {
    if (p) capi().duckdb_free(p)
  }
}
/** Out parameter receiving a handle; also what the destroy functions take. */
const slot = () => new BigUint64Array(1)
const handle = (s: BigUint64Array) => Deno.UnsafePointer.create(s[0]!)
const slotOf = (p: Pointer) => BigUint64Array.of(BigInt(Deno.UnsafePointer.value(p)))

// One cache per access mode: switching a connection to read-only would otherwise collide with the
// read-write instance while it is still open.
const caches: { readWrite?: Pointer, readOnly?: Pointer } = {}

/**
 * Opens a connection to the database at `path`. Every connection holds its own database handle from the
 * instance cache, so a file is opened only once per process and configuration.
 */
export async function connect(path: string, readOnly: boolean): Promise<Connection> {
  const c = capi()
  const cache = readOnly ? caches.readOnly ??= c.duckdb_create_instance_cache() : caches.readWrite ??= c.duckdb_create_instance_cache()
  const config = slot()
  c.duckdb_create_config(config)
  const db = slot()
  try {
    if (readOnly) c.duckdb_set_config(handle(config), cstr('access_mode'), cstr('READ_ONLY'))
    const error = slot()
    if (await c.duckdb_get_or_create_from_cache(cache, cstr(path), db, handle(config), error)) {
      throw new DbError(owned(handle(error)) || `Cannot open ${path}`)
    }
  } finally {
    c.duckdb_destroy_config(config)
  }
  const conn = slot()
  if (c.duckdb_connect(handle(db), conn)) {
    c.duckdb_close(db)
    throw new DbError(`Cannot connect to ${path}`)
  }
  return new Connection(db, conn)
}

export class Connection {
  constructor(private db: BigUint64Array, private conn: BigUint64Array) {}

  /** Runs one statement; the result streams and must be closed. `params` are bound as VARCHAR. */
  async query(sql: string, params: string[] = []): Promise<Result> {
    const c = capi()
    const prepared = slot()
    try {
      if (await c.duckdb_prepare(handle(this.conn), cstr(sql), prepared)) {
        throw new DbError(text(c.duckdb_prepare_error(handle(prepared))) || 'Connection closed')
      }
      params.forEach((p, i) => c.duckdb_bind_varchar(handle(prepared), BigInt(i + 1), cstr(p)))
      const result = new Uint8Array(48)
      if (await c.duckdb_execute_prepared_streaming(handle(prepared), result)) {
        const message = text(c.duckdb_result_error(result))
        c.duckdb_destroy_result(result)
        throw new DbError(message)
      }
      return new Result(prepared, result)
    } catch (e) {
      c.duckdb_destroy_prepare(prepared)
      throw e
    }
  }

  /** Aborts the running statement; safe to call from another task while it runs. */
  interrupt() {
    capi().duckdb_interrupt(handle(this.conn))
  }

  /** Only once no statement runs anymore. Repeated calls are no-ops (the handles are set to NULL). */
  close() {
    capi().duckdb_disconnect(this.conn)
    capi().duckdb_close(this.db)
  }
}

const QUERY_RESULT = 3

export class Result {
  readonly columns: { name: string, type: string }[] = []
  private decoders: Decoder[] = []

  constructor(private prepared: BigUint64Array, private result: Uint8Array) {
    const c = capi()
    for (let i = 0; i < Number(c.duckdb_column_count(result)); i++) {
      const type = c.duckdb_column_logical_type(result, BigInt(i))
      try {
        const { name, decode } = describe(type)
        this.columns.push({ name: text(c.duckdb_column_name(result, BigInt(i))), type: name })
        this.decoders.push(decode)
      } finally {
        c.duckdb_destroy_logical_type(slotOf(type))
      }
    }
  }

  /** False for DDL and DML, which only report a count. */
  get isQuery() {
    return capi().duckdb_result_return_type(this.result) === QUERY_RESULT
  }

  get rowsChanged() {
    return Number(capi().duckdb_rows_changed(this.result))
  }

  /** The next chunk of rows (up to 2048), undefined at the end. */
  async next(): Promise<CellValue[][] | undefined> {
    const c = capi()
    const chunk = await c.duckdb_fetch_chunk(this.result)
    if (!chunk) {
      const error = text(c.duckdb_result_error(this.result))
      if (error) throw new DbError(error)
      return undefined
    }
    try {
      const count = Number(c.duckdb_data_chunk_get_size(chunk))
      if (!count) return undefined
      const columns = this.decoders.map((decode, i) => decode(c.duckdb_data_chunk_get_vector(chunk, BigInt(i)), count))
      return Array.from({ length: count }, (_, row) => columns.map(read => read(row)))
    } finally {
      c.duckdb_destroy_data_chunk(slotOf(chunk))
    }
  }

  close() {
    capi().duckdb_destroy_result(this.result)
    capi().duckdb_destroy_prepare(this.prepared)
  }
}

// Vectors are read in place and converted to the unified value model (see `CellValue`) before the chunk is
// destroyed: BIGINT, HUGEINT and DECIMAL as string, timestamps in ISO 8601, BLOB as hex, nested types as JSON.

/** Reads the value of a row from a vector with `count` rows. */
type Decoder = (vector: Pointer, count: number) => (row: number) => CellValue
interface Described { name: string, decode: Decoder }

const T = {
  BOOLEAN: 1, TINYINT: 2, SMALLINT: 3, INTEGER: 4, BIGINT: 5, UTINYINT: 6, USMALLINT: 7, UINTEGER: 8, UBIGINT: 9,
  FLOAT: 10, DOUBLE: 11, TIMESTAMP: 12, DATE: 13, TIME: 14, INTERVAL: 15, HUGEINT: 16, VARCHAR: 17, BLOB: 18,
  DECIMAL: 19, TIMESTAMP_S: 20, TIMESTAMP_MS: 21, TIMESTAMP_NS: 22, ENUM: 23, LIST: 24, STRUCT: 25, MAP: 26,
  UUID: 27, UNION: 28, BIT: 29, TIME_TZ: 30, TIMESTAMP_TZ: 31, UHUGEINT: 32, ARRAY: 33, BIGNUM: 35, SQLNULL: 36,
  TIME_NS: 39,
} as const

function describe(type: Pointer): Described {
  const alias = owned(capi().duckdb_logical_type_get_alias(type))
  const described = describeType(type)
  return alias ? { ...described, name: alias } : described
}

/** Describes a child type the caller does not own afterwards. */
function describeChild(type: Pointer): Described {
  try {
    return describe(type)
  } finally {
    capi().duckdb_destroy_logical_type(slotOf(type))
  }
}

function describeType(type: Pointer): Described {
  const c = capi()
  const id = c.duckdb_get_type_id(type)
  switch (id) {
    case T.BOOLEAN: return { name: 'BOOLEAN', decode: fixed(1, (v, o) => v.getUint8(o) !== 0) }
    case T.TINYINT: return { name: 'TINYINT', decode: fixed(1, (v, o) => v.getInt8(o)) }
    case T.SMALLINT: return { name: 'SMALLINT', decode: fixed(2, (v, o) => v.getInt16(o, true)) }
    case T.INTEGER: return { name: 'INTEGER', decode: fixed(4, (v, o) => v.getInt32(o, true)) }
    case T.BIGINT: return { name: 'BIGINT', decode: fixed(8, (v, o) => String(v.getBigInt64(o, true))) }
    case T.UTINYINT: return { name: 'UTINYINT', decode: fixed(1, (v, o) => v.getUint8(o)) }
    case T.USMALLINT: return { name: 'USMALLINT', decode: fixed(2, (v, o) => v.getUint16(o, true)) }
    case T.UINTEGER: return { name: 'UINTEGER', decode: fixed(4, (v, o) => v.getUint32(o, true)) }
    case T.UBIGINT: return { name: 'UBIGINT', decode: fixed(8, (v, o) => String(v.getBigUint64(o, true))) }
    case T.HUGEINT: return { name: 'HUGEINT', decode: fixed(16, (v, o) => String(int128(v, o, true))) }
    case T.UHUGEINT: return { name: 'UHUGEINT', decode: fixed(16, (v, o) => String(int128(v, o, false))) }
    case T.FLOAT: return { name: 'FLOAT', decode: fixed(4, (v, o) => jsonNumber(v.getFloat32(o, true))) }
    case T.DOUBLE: return { name: 'DOUBLE', decode: fixed(8, (v, o) => jsonNumber(v.getFloat64(o, true))) }
    case T.VARCHAR: return { name: 'VARCHAR', decode: fixed(16, (v, o) => decoder.decode(bytes(v, o))) }
    case T.BLOB: return { name: 'BLOB', decode: fixed(16, (v, o) => toHex(bytes(v, o))) }
    // First byte: number of padding bits before the value.
    case T.BIT: return { name: 'BIT', decode: fixed(16, (v, o) => {
      const b = bytes(v, o)
      return Array.from(b.subarray(1), x => x.toString(2).padStart(8, '0')).join('').slice(b[0])
    }) }
    case T.BIGNUM: return { name: 'BIGNUM', decode: fixed(16, (v, o) => bignum(bytes(v, o))) }
    case T.DATE: return { name: 'DATE', decode: fixed(4, (v, o) => date(v.getInt32(o, true))) }
    case T.TIME: return { name: 'TIME', decode: fixed(8, (v, o) => time(v.getBigInt64(o, true), 6)) }
    case T.TIME_NS: return { name: 'TIME_NS', decode: fixed(8, (v, o) => time(v.getBigInt64(o, true), 9)) }
    // Upper 40 bits: microseconds of the day; lower 24 bits: 57599 (16 h - 1 s) minus the offset in seconds.
    case T.TIME_TZ: return { name: 'TIME WITH TIME ZONE', decode: fixed(8, (v, o) => {
      const bits = v.getBigUint64(o, true)
      return time(bits >> 24n, 6) + offset(57599 - Number(bits & 0xFFFFFFn))
    }) }
    case T.TIMESTAMP: return { name: 'TIMESTAMP', decode: fixed(8, (v, o) => timestamp(v.getBigInt64(o, true), 6, '')) }
    case T.TIMESTAMP_S: return { name: 'TIMESTAMP_S', decode: fixed(8, (v, o) => timestamp(v.getBigInt64(o, true), 0, '')) }
    case T.TIMESTAMP_MS: return { name: 'TIMESTAMP_MS', decode: fixed(8, (v, o) => timestamp(v.getBigInt64(o, true), 3, '')) }
    case T.TIMESTAMP_NS: return { name: 'TIMESTAMP_NS', decode: fixed(8, (v, o) => timestamp(v.getBigInt64(o, true), 9, '')) }
    case T.TIMESTAMP_TZ: return { name: 'TIMESTAMP WITH TIME ZONE', decode: fixed(8, (v, o) => timestamp(v.getBigInt64(o, true), 6, '+00:00')) }
    case T.INTERVAL: return { name: 'INTERVAL', decode: fixed(16, (v, o) => ({ months: v.getInt32(o, true), days: v.getInt32(o + 4, true), micros: String(v.getBigInt64(o + 8, true)) })) }
    // HUGEINT with the sign bit flipped, so that UUIDs sort as unsigned.
    case T.UUID: return { name: 'UUID', decode: fixed(16, (v, o) => {
      const hex = (v.getBigUint64(o + 8, true) ^ (1n << 63n)).toString(16).padStart(16, '0') + v.getBigUint64(o, true).toString(16).padStart(16, '0')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }) }
    case T.DECIMAL: {
      const width = c.duckdb_decimal_width(type)
      const scale = c.duckdb_decimal_scale(type)
      const [size, read] = INTEGERS[c.duckdb_decimal_internal_type(type)]!
      return { name: `DECIMAL(${width},${scale})`, decode: fixed(size, (v, o) => decimal(read(v, o), scale)) }
    }
    case T.ENUM: {
      const values = Array.from({ length: c.duckdb_enum_dictionary_size(type) }, (_, i) => owned(c.duckdb_enum_dictionary_value(type, BigInt(i))))
      const [size, read] = INTEGERS[c.duckdb_enum_internal_type(type)]!
      return { name: `ENUM(${values.map(v => `'${v.replaceAll('\'', '\'\'')}'`).join(', ')})`, decode: fixed(size, (v, o) => values[Number(read(v, o))]!) }
    }
    case T.LIST: {
      const child = describeChild(c.duckdb_list_type_child_type(type))
      return { name: `${child.name}[]`, decode: list(child.decode) }
    }
    // Physically a list of STRUCT(key, value); like @duckdb/node-api an array of { key, value } objects.
    case T.MAP: {
      const key = describeChild(c.duckdb_map_type_key_type(type))
      const value = describeChild(c.duckdb_map_type_value_type(type))
      return { name: `MAP(${key.name}, ${value.name})`, decode: list(struct([['key', key.decode], ['value', value.decode]])) }
    }
    case T.ARRAY: {
      const child = describeChild(c.duckdb_array_type_child_type(type))
      const size = Number(c.duckdb_array_type_array_size(type))
      return { name: `${child.name}[${size}]`, decode: array(child.decode, size) }
    }
    case T.STRUCT: {
      const fields = Array.from({ length: Number(c.duckdb_struct_type_child_count(type)) }, (_, i) =>
        [owned(c.duckdb_struct_type_child_name(type, BigInt(i))), describeChild(c.duckdb_struct_type_child_type(type, BigInt(i)))] as const)
      return { name: `STRUCT(${fields.map(([n, d]) => `"${n}" ${d.name}`).join(', ')})`, decode: struct(fields.map(([n, d]) => [n, d.decode])) }
    }
    // A struct of the tag (UTINYINT) and one child per member; like @duckdb/node-api { tag, value }.
    case T.UNION: {
      const members = Array.from({ length: Number(c.duckdb_union_type_member_count(type)) }, (_, i) =>
        [owned(c.duckdb_union_type_member_name(type, BigInt(i))), describeChild(c.duckdb_union_type_member_type(type, BigInt(i)))] as const)
      return { name: `UNION(${members.map(([n, d]) => `"${n}" ${d.name}`).join(', ')})`, decode: union(members.map(([n, d]) => [n, d.decode])) }
    }
    case T.SQLNULL: return { name: 'NULL', decode: () => () => null }
    default: throw new DbError(`Unsupported DuckDB type (id ${id})`)
  }
}

/** Physical integer types of DECIMAL and ENUM: byte size and reader. */
const INTEGERS: Record<number, [number, (v: DataView, o: number) => bigint]> = {
  [T.UTINYINT]: [1, (v, o) => BigInt(v.getUint8(o))],
  [T.USMALLINT]: [2, (v, o) => BigInt(v.getUint16(o, true))],
  [T.UINTEGER]: [4, (v, o) => BigInt(v.getUint32(o, true))],
  [T.SMALLINT]: [2, (v, o) => BigInt(v.getInt16(o, true))],
  [T.INTEGER]: [4, (v, o) => BigInt(v.getInt32(o, true))],
  [T.BIGINT]: [8, (v, o) => v.getBigInt64(o, true)],
  [T.HUGEINT]: [16, (v, o) => int128(v, o, true)],
}

function view(p: Pointer, byteLength: number): DataView {
  return new DataView(p && byteLength ? Deno.UnsafePointerView.getArrayBuffer(p, byteLength) : new ArrayBuffer(0))
}

/** One bit per row; no mask means every row is valid. */
function validity(vector: Pointer, count: number): (row: number) => boolean {
  const p = capi().duckdb_vector_get_validity(vector)
  if (!p || !count) return () => true
  const mask = new Uint32Array(Deno.UnsafePointerView.getArrayBuffer(p, Math.ceil(count / 64) * 8))
  return row => ((mask[row >>> 5]! >>> (row & 31)) & 1) === 1
}

function fixed(size: number, read: (v: DataView, offset: number) => CellValue): Decoder {
  return (vector, count) => {
    const data = view(capi().duckdb_vector_get_data(vector), count * size)
    const valid = validity(vector, count)
    return row => valid(row) ? read(data, row * size) : null
  }
}

function list(child: Decoder): Decoder {
  return (vector, count) => {
    const c = capi()
    const entries = view(c.duckdb_vector_get_data(vector), count * 16)
    const valid = validity(vector, count)
    const read = child(c.duckdb_list_vector_get_child(vector), Number(c.duckdb_list_vector_get_size(vector)))
    return (row) => {
      if (!valid(row)) return null
      const offset = Number(entries.getBigUint64(row * 16, true))
      return Array.from({ length: Number(entries.getBigUint64(row * 16 + 8, true)) }, (_, i) => read(offset + i))
    }
  }
}

function array(child: Decoder, size: number): Decoder {
  return (vector, count) => {
    const valid = validity(vector, count)
    const read = child(capi().duckdb_array_vector_get_child(vector), count * size)
    return row => valid(row) ? Array.from({ length: size }, (_, i) => read(row * size + i)) : null
  }
}

function struct(fields: (readonly [string, Decoder])[]): Decoder {
  return (vector, count) => {
    const valid = validity(vector, count)
    const reads = fields.map(([name, decode], i) => [name, decode(capi().duckdb_struct_vector_get_child(vector, BigInt(i)), count)] as const)
    return row => valid(row) ? Object.fromEntries(reads.map(([name, read]) => [name, read(row)])) : null
  }
}

function union(members: (readonly [string, Decoder])[]): Decoder {
  return (vector, count) => {
    const valid = validity(vector, count)
    const tag = fixed(1, (v, o) => v.getUint8(o))(capi().duckdb_struct_vector_get_child(vector, 0n), count)
    const reads = members.map(([, decode], i) => decode(capi().duckdb_struct_vector_get_child(vector, BigInt(i + 1)), count))
    return (row) => {
      if (!valid(row)) return null
      const t = tag(row) as number
      return { tag: members[t]![0], value: reads[t]!(row) }
    }
  }
}

/** `duckdb_string_t`: length (4 bytes), then up to 12 bytes inline or a 4-byte prefix and a pointer. */
function bytes(v: DataView, o: number): Uint8Array {
  const length = v.getUint32(o, true)
  if (length <= 12) return new Uint8Array(v.buffer, v.byteOffset + o + 4, length)
  return new Uint8Array(Deno.UnsafePointerView.getArrayBuffer(Deno.UnsafePointer.create(v.getBigUint64(o + 8, true))!, length))
}

function int128(v: DataView, o: number, signed: boolean): bigint {
  return ((signed ? v.getBigInt64(o + 8, true) : v.getBigUint64(o + 8, true)) << 64n) | v.getBigUint64(o, true)
}

/** 3-byte header (top bit set when positive), then the big-endian magnitude; negative values are inverted. */
function bignum(b: Uint8Array): string {
  const negative = (b[0]! & 0x80) === 0
  let n = 0n
  for (const x of b.subarray(3)) n = (n << 8n) | BigInt(negative ? ~x & 0xFF : x)
  return String(negative ? -n : n)
}

const jsonNumber = (n: number): CellValue => Number.isFinite(n) ? n : String(n)

function decimal(n: bigint, scale: number): string {
  if (!scale) return String(n)
  const digits = String(n < 0n ? -n : n).padStart(scale + 1, '0')
  return `${n < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** Days since 1970-01-01 → `YYYY-MM-DD` and the era suffix (proleptic Gregorian, algorithm by H. Hinnant). */
function civil(days: number): [string, string] {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  // There is no year 0: astronomical year 0 is 1 BC.
  return [`${pad(year > 0 ? year : 1 - year, 4)}-${pad(month)}-${pad(day)}`, year > 0 ? '' : ' (BC)']
}

const DATE_INFINITY = 2147483647
function date(days: number): string {
  if (days === DATE_INFINITY) return 'infinity'
  if (days === -DATE_INFINITY) return '-infinity'
  return civil(days).join('')
}

/** Time of day from a count of 10^-digits seconds; trailing zeros of the fraction are dropped. */
function time(value: bigint, digits: number): string {
  const unit = 10n ** BigInt(digits)
  const seconds = Number(value / unit)
  const fraction = String(value % unit).padStart(digits, '0').replace(/0+$/, '')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}${fraction ? `.${fraction}` : ''}`
}

const TIMESTAMP_INFINITY = 2n ** 63n - 1n
function timestamp(value: bigint, digits: number, zone: string): string {
  if (value === TIMESTAMP_INFINITY) return 'infinity'
  if (value === -TIMESTAMP_INFINITY) return '-infinity'
  const perDay = 86400n * 10n ** BigInt(digits)
  let days = value / perDay
  let rest = value % perDay
  if (rest < 0n) {
    days -= 1n
    rest += perDay
  }
  const [day, era] = civil(Number(days))
  return `${day}T${time(rest, digits)}${zone}${era}`
}

function offset(seconds: number): string {
  const abs = Math.abs(seconds)
  const minutes = Math.floor(abs / 60) % 60
  return `${seconds < 0 ? '-' : '+'}${pad(Math.floor(abs / 3600))}${minutes ? `:${pad(minutes)}` : ''}`
}
