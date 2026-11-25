// Sets the masked and unmasked columns of a connection without closing its sessions (unlike saving the connection).
import { parseColumnList } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = (await readBody<{ maskColumns?: unknown; unmaskColumns?: unknown }>(event)) ?? {}
  const connection = await store.get(id)
  await store.save({
    ...connection,
    maskColumns: parseColumnList(body.maskColumns),
    unmaskColumns: parseColumnList(body.unmaskColumns),
  })
  return (await store.list()).find((c) => c.id === id)
})
