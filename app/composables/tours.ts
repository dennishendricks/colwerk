// Guided tours (app/tours): the ones that exist, each one's status for the user (tours.json via /api/tours) and the
// one running (TourHost.vue). The tour files are separate chunks, loaded on first use together with the states.
import type { TourStates, TourStatus } from '#core'
import { type Tour, tourCategories } from '~/utils/tour'

/** Number of tours the intro (TourIntro.vue) offers at once. */
export const INTRO_TOURS = 3

const modules = import.meta.glob<Tour>('../tours/*.ts', { import: 'default' })

/** All tours, the most important first; empty until loaded. */
const tours = shallowRef<Tour[]>([])
const states = ref<TourStates>()
const running = ref<Tour>()
/** The intro was closed; it shows again on the next start. */
const introHidden = ref(false)
let loading: Promise<void> | undefined

export function useTours() {
  loading ??= Promise.all([Promise.all(Object.values(modules).map((load) => load())), api<TourStates>('/api/tours')])
    .then(([loaded, s]) => {
      tours.value = loaded.sort((a, b) => b.priority - a.priority)
      states.value = s
    })
    .catch(() => (loading = undefined))

  const statusOf = (id: string): TourStatus => states.value?.[id] ?? 'open'
  /** The most important tours not completed yet; empty until loaded. */
  const suggested = computed(() =>
    states.value ? tours.value.filter((t) => statusOf(t.id) !== 'completed').slice(0, INTRO_TOURS) : [],
  )
  const introShown = computed(() => !introHidden.value && !running.value && suggested.value.length > 0)

  /** The tours per category (Help → Tutorials), categories in the order of `tourCategories`. */
  const groups = computed(() =>
    tourCategories
      .map((category) => ({ category, tours: tours.value.filter((t) => t.category === category) }))
      .filter((g) => g.tours.length),
  )

  async function setStatus(id: string, status: TourStatus) {
    states.value = await api<TourStates>('/api/tours', { method: 'POST', body: { id, status } })
  }

  const start = (tour: Tour) => (running.value = tour)

  return { tours, groups, running, introHidden, introShown, suggested, statusOf, setStatus, start }
}
