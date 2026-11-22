import type { CellValue } from '../types.ts'

/** Engines of the schema compare (ALTER covers everything) and of the data compare. */
export const schemaCompareDialects = ['postgres', 'mysql', 'mssql'] as const
export const dataCompareDialects = ['postgres', 'mysql', 'mssql', 'sqlite', 'duckdb'] as const

/** MySQL: `schema` is the database. */
export interface SchemaRef {
  connectionId: string
  database?: string
  schema: string
}

export interface TableRef extends SchemaRef {
  table: string
}

export interface SnapshotColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  /** SQL Server: name of the default constraint; not compared. */
  defaultName?: string
  /** PostgreSQL: 'always' | 'by default'; SQL Server: 'seed,increment'; MySQL: 'auto_increment'. */
  identity: string | null
  /** PostgreSQL: the column owns a sequence; it is created as serial and its default is not compared. */
  serial?: boolean
  generated: { expression: string; stored: boolean } | null
}

export interface SnapshotConstraint {
  name: string
  type: 'primary' | 'unique' | 'check' | 'foreign'
  /** Text after the name, with the schema of the source replaced by the target's. */
  definition: string
  columns: string[]
}

export interface SnapshotIndex {
  name: string
  /** The full CREATE INDEX statement, without semicolon. */
  definition: string
}

export interface SnapshotTable {
  name: string
  columns: SnapshotColumn[]
  constraints: SnapshotConstraint[]
  indexes: SnapshotIndex[]
}

export interface SnapshotView {
  name: string
  definition: string
}

export interface SchemaSnapshot {
  schema: string
  tables: SnapshotTable[]
  views: SnapshotView[]
  /** Objects that exist but are not compared (e.g. functional indexes). */
  skipped: string[]
}

/** `added` means only in the source. */
export type DiffStatus = 'added' | 'removed' | 'changed' | 'same'

export interface PartDiff {
  part: 'column' | 'constraint' | 'index'
  name: string
  status: DiffStatus
}

export interface ObjectDiff {
  kind: 'table' | 'view'
  name: string
  status: DiffStatus
  /** CREATE text of the object on each side, for the side-by-side view. */
  source: string | null
  target: string | null
  parts: PartDiff[]
}

export interface SchemaCompareResult {
  objects: ObjectDiff[]
  script: string
  skipped: string[]
}

export interface DataCompareRequest {
  /** Names the tabs of both sides (`compare:<id>:source|target`), so that the run can be cancelled. */
  id: string
  source: TableRef
  target: TableRef
  /** Columns that identify a row; default is the primary key. */
  keys?: string[]
  /** Absolute path the script is written to when it has more than SCRIPT_LIMIT statements. */
  path?: string
}

export interface DataCompareResult {
  columns: string[]
  keys: string[]
  /** Columns only on one side (and generated columns), which are not compared. */
  ignored: { source: string[]; target: string[] }
  counts: { same: number; onlyInSource: number; onlyInTarget: number; different: number }
  samples: {
    onlyInSource: CellValue[][]
    onlyInTarget: CellValue[][]
    different: { source: CellValue[]; target: CellValue[]; changed: string[] }[]
  }
  /** Number of INSERT, UPDATE and DELETE statements. */
  statements: number
  /** Null when there are more than SCRIPT_LIMIT statements and no `path` was given. */
  script: string | null
}

export const SAMPLE_LIMIT = 1000
export const SCRIPT_LIMIT = 10_000
