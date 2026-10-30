export default defineEventHandler(async () => (await store.list()).map(c => ({ ...c, disconnected: workbench.isDisconnected(c.id) })))
