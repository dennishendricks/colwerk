// Tour: run a query, on the demo database (docs: start/first-steps, editor/running-queries)
export default defineTour({
  id: 'first-query',
  category: 'editor',
  priority: 90,
  steps: () => {
    const { openTab, runTab } = useDemo()
    return [
      { key: 'editor', target: tourTarget('editor'), side: 'bottom', before: () => openTab() },
      { key: 'run', target: tourTarget('run'), side: 'bottom' },
      { key: 'results', target: tourTarget('results'), side: 'top', before: runTab },
      { key: 'limits', target: tourTarget('limits'), side: 'bottom' },
      { key: 'history', target: tourTarget('history'), side: 'bottom' },
    ]
  },
})
