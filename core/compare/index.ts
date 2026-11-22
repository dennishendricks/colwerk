import type { SplitDialect } from '../sql-split.ts'
import type { Workbench } from '../workbench.ts'
import { diffSnapshots } from './schema-diff.ts'
import { deployScript } from './schema-script.ts'
import { snapshotMysql } from './snapshot-mysql.ts'
import { snapshotPostgres } from './snapshot-postgres.ts'
import { replaceSchema } from './sql.ts'
import type { SchemaCompareResult, SchemaRef, SchemaSnapshot } from './types.ts'

export * from './types.ts'
export { compareData } from './data.ts'

async function snapshot(wb: Workbench, dialect: SplitDialect, ref: SchemaRef): Promise<SchemaSnapshot> {
  // SQL Server's driver (tedious) is only loaded when it is needed.
  const load =
    dialect === 'postgres'
      ? snapshotPostgres
      : dialect === 'mysql'
        ? snapshotMysql
        : (await import('./snapshot-mssql.ts')).snapshotMssql
  return { schema: ref.schema, ...(await wb.metadata(ref.connectionId, ref.database, (s) => load(s, ref.schema))) }
}

/** What to run on the target so that its schema equals the source's; both are of the same engine `dialect`. */
export async function compareSchemas(
  wb: Workbench,
  dialect: SplitDialect,
  sourceRef: SchemaRef,
  targetRef: SchemaRef,
): Promise<SchemaCompareResult> {
  const [source, target] = await Promise.all([snapshot(wb, dialect, sourceRef), snapshot(wb, dialect, targetRef)])
  // The script is written for the target schema, so the source's qualifiers become the target's.
  const retarget = (text: string) => replaceSchema(text, source.schema, target.schema, dialect)
  for (const t of source.tables) {
    for (const c of t.constraints) c.definition = retarget(c.definition)
    for (const i of t.indexes) i.definition = retarget(i.definition)
  }
  for (const v of source.views) v.definition = retarget(v.definition)
  const diff = diffSnapshots(dialect, source, target)
  return { ...deployScript(dialect, diff, source, target), skipped: [...source.skipped, ...target.skipped] }
}
