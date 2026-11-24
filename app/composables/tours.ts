// Guided tours (app/tours): the ones that exist, each one's status for the user (tours.json via /api/tours) and the
// one running (TourHost.vue)
import type { TourStates, TourStatus } from '#core'
import { type Tour, tourCategories } from '~/utils/tour'

/** Number of tours the intro (TourIntro.vue) offers at once. */
export const INTRO_TOURS = 3

const modules = import.meta.glob<{ default: Tour }>('../tours/*.ts', { eager: true })
/** All tours, the most important first. */
export const tours = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => b.priority - a.priority)

/** The tours per category (Help → Tutorials), categories in the order of `tourCategories`. */
export const tourGroups = () =>
  tourCategories
    .map((category) => ({ category, tours: tours.filter((t) => t.category === category) }))
    .filter((g) => g.tours.length)

const states = ref<TourStates>()
const running = ref<string>()
/** The intro was closed; it shows again on the next start. */
const introHidden = ref(false)
let loading: Promise<void> | undefined

export function useTours() {
  loading ??= api<TourStates>('/api/tours')
    .then((s) => void (states.value = s))
    .catch(() => (loading = undefined))

  const statusOf = (id: string): TourStatus => states.value?.[id] ?? 'open'
  /** The most important tours not completed yet; empty until the states are loaded. */
  const suggested = computed(() =>
    states.value ? tours.filter((t) => statusOf(t.id) !== 'completed').slice(0, INTRO_TOURS) : [],
  )

  async function setStatus(id: string, status: TourStatus) {
    states.value = await api<TourStates>('/api/tours', { method: 'POST', body: { id, status } })
  }

  const start = (id: string) => (running.value = id)

  return { running, introHidden, suggested, statusOf, setStatus, start }
}
