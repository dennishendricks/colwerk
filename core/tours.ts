// Progress of the guided tours (app/tours), stored in `tours.json` in the data directory
export const tourStatuses = ['completed', 'cancelled'] as const
/** A tour without stored status is open. */
export type TourStatus = (typeof tourStatuses)[number] | 'open'
/** Stored status per tour id; open tours have no entry. */
export type TourStates = Record<string, Exclude<TourStatus, 'open'>>

/** The valid entries of `value`. */
export function parseTourStates(value: unknown): TourStates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, status]) => tourStatuses.includes(status))) as TourStates
}

/** `states` with the status of tour `id` set; a completed tour stays completed when it is cancelled later. */
export function withTourStatus(states: TourStates, id: string, status: TourStatus): TourStates {
  const { [id]: previous, ...rest } = states
  if (status === 'open') return rest
  return { ...rest, [id]: previous === 'completed' && status === 'cancelled' ? previous : status }
}
