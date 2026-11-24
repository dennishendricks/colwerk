// Tour: connect your own database (docs: connections/index, connections/databases, connections/import)
export default defineTour({
  id: 'new-connection',
  category: 'connections',
  priority: 95,
  steps: () => {
    const closeDialog = () => runMenuAction('close-dialogs')
    return [
      { key: 'list', target: tourTarget('connections'), side: 'right' },
      {
        key: 'engine',
        target: tourTarget('connection-engine'),
        side: 'right',
        before: () => runMenuAction('new-connection'),
      },
      { key: 'details', target: tourDialog(), side: 'right' },
      { key: 'options', target: tourTarget('connection-options'), side: 'right' },
      { key: 'save', target: tourTarget('connection-actions'), side: 'top', leave: closeDialog },
      { key: 'import', target: tourTarget('connections'), side: 'right' },
    ]
  },
})
