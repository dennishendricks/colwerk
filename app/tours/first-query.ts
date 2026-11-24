// Tour: run a query, on the in-memory demo database (docs: start/first-steps, editor/running-queries)
import type { QueryTab } from '~/composables/tabs'

export default defineTour({
  id: 'first-query',
  category: 'editor',
  priority: 90,
  steps: () => {
    const { openTab, run } = useDemo()
    let tab: QueryTab | undefined
    return [
      { key: 'editor', target: tourTarget('editor'), side: 'bottom', before: async () => (tab = await openTab()) },
      { key: 'run', target: tourTarget('run'), side: 'bottom' },
      { key: 'results', target: tourTarget('results'), side: 'top', before: () => tab && run(tab, tab.sql) },
      { key: 'limits', target: tourTarget('limits'), side: 'bottom' },
      { key: 'history', target: tourTarget('history'), side: 'bottom' },
    ]
  },
})
