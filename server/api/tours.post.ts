// Sets the status of one guided tour; answers with the states of all tours
import { tourStatuses } from '#core'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: unknown; status?: unknown }>(event)
  const status = body?.status
  if (typeof body?.id !== 'string' || !body.id || (status !== 'open' && !tourStatuses.includes(status as never)))
    throw createError({ statusCode: 400, message: 'id and a valid status are required' })
  return setTourStatus(body.id, status as 'open' | (typeof tourStatuses)[number])
})
