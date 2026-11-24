// Tour: compare schemas and data of two connections (docs: data/compare)
export default defineTour({
  id: 'data-compare',
  category: 'data',
  priority: 25,
  steps: () => [
    { key: 'open', target: tourTarget('compare'), side: 'bottom' },
    { key: 'kind', target: tourTarget('compare-kind'), side: 'bottom', before: () => runMenuAction('compare') },
    // Centered: the dialog fills the window, a popover next to it would not fit.
    { key: 'sync', leave: () => runMenuAction('close-dialogs') },
  ],
})
