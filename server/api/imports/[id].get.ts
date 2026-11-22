export default defineEventHandler((event) => {
  const progress = progressOf(getRouterParam(event, 'id')!)
  if (!progress) throw createError({ statusCode: 404, message: 'No such import' })
  return progress
})
