// Definition of a guided tour; each tour is one file in app/tours, collected by composables/tours.ts

/** Categories group the tours in the Help menu, in this order. */
export const tourCategories = ['start', 'editor', 'data'] as const

export interface TourStep {
  /** Texts `tours.<tour id>.<key>.title` and `.body` (i18n). */
  key: string
  /** Element the step points to (see `tourTarget`); none: the step is centered. */
  target?: () => Element | null | undefined
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Runs before the step is shown, e.g. to open the demo tab or run its query. */
  before?: () => unknown
}

export interface Tour {
  /** Also the i18n key `tours.<id>.title`. */
  id: string
  category: (typeof tourCategories)[number]
  /** Higher comes first in the intro. */
  priority: number
  /** Called once in the setup of TourHost.vue, so the steps may use composables. */
  steps: () => TourStep[]
}

export const defineTour = (tour: Tour) => tour

/**
 * The shown element marked with `data-tour="<name>"`: each tab has its own panel, the inactive ones hidden
 * (`display: none`, no client rects).
 */
export const tourTarget = (name: string) => () =>
  [...document.querySelectorAll(`[data-tour="${name}"]`)].find((el) => el.getClientRects().length > 0)
