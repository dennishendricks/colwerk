/* eslint-disable @typescript-eslint/no-dynamic-delete -- the reactive records below are keyed maps; deleting entries is intended. */
import type { ColumnInfo, DatabaseInfo, IndexInfo, IntrospectRequest, RoutineInfo, SchemaInfo, TableInfo } from '#core'

// Schema tree: loaded lazily per level; the server caches, `refresh` bypasses both caches.

/** A connection, switched to `database` when set (otherwise its configured default database). */
export interface SchemaTarget {
  connectionId: string
  database?: string
}

interface SchemaState {
  databases?: DatabaseInfo[]
  schemas?: SchemaInfo[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnInfo[]>
  /** Keyed like `columns`. */
  indexes: Record<string, IndexInfo[]>
  routines: Record<string, RoutineInfo[]>
  loading: Record<string, boolean>
  errors: Record<string, string>
}

// Keyed by stateKey().
const schemaState = reactive<Record<string, SchemaState>>({})
const inflight = new Map<string, Promise<void>>()

const stateKey = (target: SchemaTarget) => JSON.stringify([target.connectionId, target.database ?? null])

/** Drops the loaded schemas of every database of a connection. */
export function forgetSchemas(connectionId: string) {
  for (const key of Object.keys(schemaState)) {
    if (JSON.parse(key)[0] === connectionId) delete schemaState[key]
  }
}

const DEFAULT_SCHEMAS = ['public', 'dbo', 'main']

export function useSchema() {
  function state(target: SchemaTarget): SchemaState {
    return (schemaState[stateKey(target)] ??= {
      tables: {},
      columns: {},
      indexes: {},
      routines: {},
      loading: {},
      errors: {},
    })
  }

  // A second call while loading waits for the first one instead of loading again.
  function introspect<T>(
    target: SchemaTarget,
    key: string,
    request: IntrospectRequest,
    refresh: boolean,
    assign: (s: SchemaState, v: T) => void,
  ) {
    const id = JSON.stringify([stateKey(target), key])
    let pending = inflight.get(id)
    if (pending) return pending
    const s = state(target)
    s.loading[key] = true
    delete s.errors[key]
    pending = api<T>(`/api/connections/${target.connectionId}/introspect`, {
      method: 'POST',
      body: { request, refresh, database: target.database },
    })
      .then(
        (v) => assign(s, v),
        (e) => {
          s.errors[key] = errorMessage(e)
        },
      )
      .finally(() => {
        s.loading[key] = false
        inflight.delete(id)
      })
    inflight.set(id, pending)
    return pending
  }

  /** `group` keys the indexes of a table or the routines of a schema (loading state, expansion). */
  const keyOf = (schema: string, table?: string, group?: 'indexes' | 'routines') =>
    JSON.stringify([schema, table ?? null, ...(group ? [group] : [])])

  /** Databases the login can switch to; listed through the connection's default database. */
  const loadDatabases = (connectionId: string, refresh = false) =>
    introspect<DatabaseInfo[]>(
      { connectionId },
      'databases',
      { kind: 'databases' },
      refresh,
      (s, v) => (s.databases = v),
    )

  const loadSchemas = (target: SchemaTarget, refresh = false) =>
    introspect<SchemaInfo[]>(target, 'schemas', { kind: 'schemas' }, refresh, (s, v) => {
      s.schemas = v
      if (refresh) {
        s.tables = {}
        s.columns = {}
        s.indexes = {}
        s.routines = {}
      }
    })

  const loadTables = (target: SchemaTarget, schema: string, refresh = false) =>
    introspect<TableInfo[]>(
      target,
      keyOf(schema),
      { kind: 'tables', schema },
      refresh,
      (s, v) => (s.tables[schema] = v),
    )

  const loadColumns = (target: SchemaTarget, schema: string, table: string, refresh = false) =>
    introspect<ColumnInfo[]>(
      target,
      keyOf(schema, table),
      { kind: 'columns', schema, table },
      refresh,
      (s, v) => (s.columns[keyOf(schema, table)] = v),
    )

  const loadIndexes = (target: SchemaTarget, schema: string, table: string, refresh = false) =>
    introspect<IndexInfo[]>(
      target,
      keyOf(schema, table, 'indexes'),
      { kind: 'indexes', schema, table },
      refresh,
      (s, v) => (s.indexes[keyOf(schema, table)] = v),
    )

  const loadRoutines = (target: SchemaTarget, schema: string, refresh = false) =>
    introspect<RoutineInfo[]>(
      target,
      keyOf(schema, undefined, 'routines'),
      { kind: 'routines', schema },
      refresh,
      (s, v) => (s.routines[schema] = v),
    )

  /** Current definition of a table, view or routine (not cached). */
  const loadDdl = (target: SchemaTarget, schema: string, name: string, object: 'table' | 'view' | 'routine') =>
    api<{ ddl: string }>(`/api/connections/${target.connectionId}/introspect`, {
      method: 'POST',
      body: { request: { kind: 'ddl', schema, name, object }, database: target.database },
    }).then((r) => r.ddl)

  /** Default schema for unqualified names in autocomplete. */
  function defaultSchema(target: SchemaTarget): string | undefined {
    const names = state(target).schemas?.map((s) => s.name) ?? []
    return names.length === 1 ? names[0] : DEFAULT_SCHEMAS.find((n) => names.includes(n))
  }

  /** Everything loaded so far, in the shape `@codemirror/lang-sql` expects: schema → table → columns. */
  function completionSchema(target: SchemaTarget): Record<string, Record<string, string[]>> {
    const s = state(target)
    const out: Record<string, Record<string, string[]>> = {}
    for (const [schema, tables] of Object.entries(s.tables)) {
      out[schema] = Object.fromEntries(
        tables.map((t) => [t.name, s.columns[keyOf(schema, t.name)]?.map((c) => c.name) ?? []]),
      )
    }
    return out
  }

  return {
    state,
    keyOf,
    loadDatabases,
    loadSchemas,
    loadTables,
    loadColumns,
    loadIndexes,
    loadRoutines,
    loadDdl,
    defaultSchema,
    completionSchema,
  }
}
