// Definition of a guided tour; each tour is one file in app/tours, collected by composables/tours.ts

/** Categories group the tours in the Help menu, in this order. */
export const tourCategories = ['start', 'connections', 'editor', 'data', 'mcp'] as const

export interface TourStep {
  /** Texts `tours.<tour id>.<key>.title` and `.body` (i18n). */
  key: string
  /** Element the step points to (see `tourTarget`); none: the step is centered. */
  target?: () => Element | null | undefined
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Runs before the step is shown (also when it is reached with Back), e.g. to open a tab, run a query or a dialog. */
  before?: () => unknown
  /** Runs when the step is left (Next, Back or end of the tour), e.g. to close the dialog `before` opened. */
  leave?: () => unknown
}

export interface Tour {
  /** Also the i18n key `tours.<id>.title`. */
  id: string
  category: (typeof tourCategories)[number]
  /** Higher comes first in the intro. */
  priority: number
  /** Called when the tour starts, in the setup of TourHost.vue, so the steps may use composables. */
  steps: () => TourStep[]
}

export const defineTour = (tour: Tour) => tour

const shown = (el: Element) => el.getClientRects().length > 0

/**
 * The shown element marked with `data-tour="<name>"`: each tab has its own panel, the inactive ones hidden
 * (`display: none`, no client rects).
 */
export const tourTarget = (name: string) => () => [...document.querySelectorAll(`[data-tour="${name}"]`)].find(shown)

/** The dialog opened last (modal), not the tour's own popover. */
export const tourDialog = () => () =>
  [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
    .filter((el) => !el.closest('.tour-popover'))
    .at(-1)

/** Waits up to 3 s for `find` to return an element, e.g. the grid of a query just run. */
export async function waitForElement(find: () => Element | null | undefined) {
  for (let i = 0; i < 180; i++) {
    const el = find()
    if (el) return el
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/** Opens a collapsed tree node (`aria-expanded`) marked with `data-tour="<name>"`, once it is there. */
export async function expandTarget(name: string) {
  const el = await waitForElement(tourTarget(name))
  if (el instanceof HTMLElement && el.getAttribute('aria-expanded') !== 'true') el.click()
}
