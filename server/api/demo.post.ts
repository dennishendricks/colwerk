// Prepares the demo database of a guided tour (see core/demo.ts): saves the connection again if it was deleted and
// creates its tables; answers with the connection's id
import { DEMO_SETUP_SQL, demoConnection, type DemoVariant, demoVariants } from '#core'

export default defineEventHandler(async (event) => {
  const variant = (await readBody<{ variant?: DemoVariant }>(event))?.variant ?? 'default'
  if (!demoVariants.includes(variant)) throw createError({ statusCode: 400, message: 'Unknown variant' })
  const demo = demoConnection(variant)
  let id = (await store.list()).find((c) => c.dialect === 'duckdb' && c.file === ':memory:' && c.name === demo.name)?.id
  if (!id) {
    const input = parseConnection(demo)
    await store.save(input)
    id = input.id
  }
  // A demo connection the user disconnected is connected again.
  workbench.connect(id)
  // In a session of its own and not through the execute route, so the setup stays out of the history. The session
  // stays open: an in-memory database lives only while a session has it open (deleting the connection closes it).
  await dbCall(() => workbench.execute(`demo:${id}`, id, DEMO_SETUP_SQL, 1, 60))
  // Tables listed before the setup (e.g. after a tour dropped one) would stay cached.
  await dbCall(() => workbench.introspect(id, { kind: 'tables', schema: 'main' }, true))
  return { connectionId: id }
})
