import { fileDialog } from '#core'

// Opens a native file dialog on this machine (the server only listens on 127.0.0.1) and answers
// once it is closed; `path` is null if the user cancelled.
export default defineEventHandler(async (event) => {
  const { kind, defaultName, title } = await readBody<{ kind?: string, defaultName?: string, title?: string }>(event)
  if (kind !== 'open' && kind !== 'save') throw createError({ statusCode: 400, message: 'kind must be open or save' })
  return { path: (await dbCall(() => fileDialog(kind, typeof defaultName === 'string' ? defaultName : '', typeof title === 'string' ? title : ''))) ?? null }
})
