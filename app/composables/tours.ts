// Guided tours (app/tours): the ones that exist, each one's status for the user (tours.json via /api/tours) and the
// one running (TourHost.vue). The tour files are separate chunks, loaded on first use together with the states.
// On start, the most important tours not completed yet are offered as toasts (offerTours).
import type { TourStates, TourStatus } from '#core'
import { type Tour, tourCategories } from '~/utils/tour'

/** Number of tours offered as toasts on start. */
export const INTRO_TOURS = 3

const modules = import.meta.glob<Tour>('../tours/*.ts', { import: 'default' })

/** All tours, the most important first; empty until loaded. */
const tours = shallowRef<Tour[]>([])
const states = ref<TourStates>()
const running = ref<Tour>()
let loading: Promise<void> | undefined

export function useTours() {
  loading ??= Promise.all([Promise.all(Object.values(modules).map((load) => load())), api<TourStates>('/api/tours')])
    .then(([loaded, s]) => {
      tours.value = loaded.sort((a, b) => b.priority - a.priority)
      states.value = s
    })
    .catch(() => (loading = undefined))

  const toast = useToast()
  const { t } = useNuxtApp().$i18n

  const statusOf = (id: string): TourStatus => states.value?.[id] ?? 'open'
  /** The most important tours not completed yet; empty until loaded. */
  const suggested = computed(() =>
    states.value ? tours.value.filter((t) => statusOf(t.id) !== 'completed').slice(0, INTRO_TOURS) : [],
  )

  /** The tours per category (Help → Tutorials), categories in the order of `tourCategories`. */
  const groups = computed(() =>
    tourCategories
      .map((category) => ({ category, tours: tours.value.filter((t) => t.category === category) }))
      .filter((g) => g.tours.length),
  )

  async function setStatus(id: string, status: TourStatus) {
    states.value = await api<TourStates>('/api/tours', { method: 'POST', body: { id, status } })
  }

  // A running tour removes the offers; they come back on the next start.
  function start(tour: Tour) {
    for (const { id } of toast.toasts.value) if (String(id).startsWith('tour-offer-')) toast.remove(id)
    running.value = tour
  }

  /**
   * Offers each suggested tour as a toast, once, as soon as the tours are loaded. Toasts closed or hidden for good
   * are not replaced by the next tours until the next start.
   */
  function offerTours() {
    watch(
      suggested,
      (offered) => {
        for (const tour of offered) {
          const id = `tour-offer-${tour.id}`
          toast.add({
            id,
            title: t(`tours.${tour.id}.title`),
            description:
              statusOf(tour.id) === 'cancelled'
                ? `${t('tours.introHint')} · ${t('tours.cancelled')}`
                : t('tours.introHint'),
            icon: 'i-lucide-graduation-cap',
            duration: 0,
            actions: [
              {
                label: t('tours.dontShowAgain'),
                icon: 'i-lucide-eye-off',
                color: 'neutral',
                variant: 'ghost',
                // Counts as completed. The toast closes itself after the click.
                onClick: () =>
                  setStatus(tour.id, 'completed').catch((e) =>
                    toast.add({
                      title: t('tours.failed'),
                      description: errorMessage(e),
                      color: 'error',
                      icon: 'i-lucide-circle-alert',
                    }),
                  ),
              },
              { label: t('tours.start'), icon: 'i-lucide-play', onClick: () => start(tour) },
            ],
          })
        }
      },
      { once: true },
    )
  }

  return { tours, groups, running, suggested, statusOf, setStatus, start, offerTours }
}
