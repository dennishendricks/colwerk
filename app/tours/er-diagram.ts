// Tour: the ER diagram of the demo tables (docs: data/er-diagrams)
export default defineTour({
  id: 'er-diagram',
  category: 'data',
  priority: 35,
  steps: () => {
    const { connect } = useDemo()
    return [
      {
        key: 'open',
        target: tourTarget('schema-main'),
        side: 'right',
        before: async () => {
          await connect()
          await waitForElement(tourTarget('schema-main'))
        },
      },
      // Centered: the diagram fills the full-screen dialog, a popover next to it would not fit.
      {
        key: 'diagram',
        before: async () => {
          runMenuAction('er-diagram')
          await waitForElement(tourTarget('er-diagram'))
        },
      },
      {
        key: 'toolbar',
        target: tourTarget('er-toolbar'),
        side: 'bottom',
        leave: () => runMenuAction('close-dialogs'),
      },
    ]
  },
})
