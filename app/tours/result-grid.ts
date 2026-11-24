// Tour: sort, filter and export a result, on the in-memory demo database (docs: data/result-grid, data/export)
export default defineTour({
  id: 'result-grid',
  category: 'data',
  priority: 80,
  steps: () => {
    const { openTab } = useDemo()
    return [
      { key: 'grid', target: tourTarget('grid'), side: 'top', before: () => openTab(true) },
      { key: 'columns', target: () => tourTarget('grid')()?.querySelector('thead'), side: 'bottom' },
      { key: 'filter', target: tourTarget('filter'), side: 'bottom' },
      { key: 'export', target: tourTarget('export'), side: 'top' },
    ]
  },
})
