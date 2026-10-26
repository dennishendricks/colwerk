export default defineEventHandler(async (event) => {
  const config = await store.resolve(parseConnection(await readBody(event)))
  await dbCall(() => workbench.test(config))
  return { ok: true }
})
