// Select items and loading of cascading schema and table pickers for a connection (and database)

export function useSchemaLevels() {
  const { state, loadSchemas, loadTables } = useSchema()

  const schemaItems = (tg?: SchemaTarget) =>
    tg ? (state(tg).schemas ?? []).map((s) => ({ label: s.name, value: s.name })) : []
  const tableItems = (tg: SchemaTarget | undefined, schema?: string) =>
    tg && schema ? (state(tg).tables[schema] ?? []).map((x) => ({ label: x.name, value: x.name })) : []

  /** Loads what the pickers of `tg` need: its schemas, and once chosen the tables of `schema`. */
  async function loadLevels(tg?: SchemaTarget, schema?: string) {
    if (!tg) return
    if (!state(tg).schemas) await loadSchemas(tg)
    if (schema && !state(tg).tables[schema]) await loadTables(tg, schema)
  }

  return { schemaItems, tableItems, loadLevels }
}
