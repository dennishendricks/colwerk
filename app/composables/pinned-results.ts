// Result sets of a query tab: the current one, pinned ones, and which of them is shown
import type { QueryTab } from './tabs'

export function usePinnedResults(tab: QueryTab) {
  const { t } = useI18n()

  const currentSet = computed(() => tab.result?.resultSets[tab.resultIndex])
  const pinView = computed(() => tab.pinned?.find((p) => p.id === tab.viewPin))
  // A pinned result replaces the current one, except in the comparison, where both are shown.
  const viewedPin = computed(() => (tab.compare ? undefined : pinView.value))
  const shown = computed(() => viewedPin.value?.set ?? currentSet.value)
  const canPin = computed(() => !!currentSet.value?.columns.length && !viewedPin.value)

  function pinResult() {
    const { result, source } = tab
    const set = currentSet.value
    if (!result || !source || !set) return
    const pin = markRaw({
      id: crypto.randomUUID(),
      set,
      source: { ...source },
      executedAt: tab.executedAt ?? Date.now(),
      durationMs: result.durationMs,
    })
    ;(tab.pinned ??= []).push(pin)
  }

  function closePin(id: string) {
    tab.pinned = tab.pinned?.filter((p) => p.id !== id)
    if (tab.viewPin === id) {
      tab.viewPin = undefined
      tab.compare = false
    }
  }

  function selectResult(i: number) {
    tab.resultIndex = i
    if (!tab.compare) tab.viewPin = undefined
  }

  const resultItems = computed(
    () => tab.result?.resultSets.map((_, i) => ({ label: t('query.result', { n: i + 1 }), value: i })) ?? [],
  )

  return { currentSet, pinView, viewedPin, shown, canPin, resultItems, pinResult, closePin, selectResult }
}
