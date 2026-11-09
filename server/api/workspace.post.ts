// Saves the open tabs of one window (see server/utils/workspace.ts).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ window?: unknown; tabs?: unknown; activeTabId?: string }>(event)
  if (typeof body?.window !== 'string' || !Array.isArray(body.tabs))
    throw createError({ statusCode: 400, message: 'window and tabs are required' })
  await saveWindowWorkspace(body.window, { tabs: body.tabs, activeTabId: body.activeTabId })
  return { ok: true }
})
