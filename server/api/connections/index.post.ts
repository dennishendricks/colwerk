export default defineEventHandler(async (event) => {
  const input = parseConnection(await readBody(event))
  await store.save(input)
  await workbench.closeConnection(input.id)
  return (await store.list()).find(c => c.id === input.id)
})
