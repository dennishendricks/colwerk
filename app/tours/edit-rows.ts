// Tour: edit rows in the result grid, on the demo table `orders` (docs: data/editing)
export default defineTour({
  id: 'edit-rows',
  category: 'data',
  priority: 72,
  steps: () => {
    const { openTab } = useDemo()
    return [
      {
        key: 'editable',
        target: tourTarget('grid-edit'),
        side: 'top',
        before: () => openTab('select * from orders order by id;\n', { run: true }),
      },
      { key: 'cell', target: () => tourTarget('grid')()?.querySelector('tbody tr'), side: 'bottom' },
      { key: 'rows', target: tourTarget('grid-edit'), side: 'top' },
      { key: 'review', target: tourTarget('grid-edit'), side: 'top' },
      { key: 'read-only', target: tourTarget('export'), side: 'top' },
    ]
  },
})
