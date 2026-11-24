// Tour: find tables and generate SQL in the schema tree, on the demo tables (docs: data/schema-tree, editor/tabs)
export default defineTour({
  id: 'schema-tree',
  category: 'data',
  priority: 85,
  steps: () => {
    const { connect } = useDemo()
    return [
      { key: 'tree', target: tourTarget('schema'), side: 'right', before: () => connect() },
      { key: 'table', target: tourTarget('table-orders'), side: 'right', before: () => expandTarget('schema-main') },
      {
        key: 'columns',
        target: tourTarget('columns-orders'),
        side: 'right',
        before: () => expandTarget('table-orders'),
      },
      { key: 'query', target: tourTarget('table-orders'), side: 'right' },
      { key: 'menu', target: tourTarget('table-customers'), side: 'right' },
      {
        key: 'quick-open',
        target: tourDialog(),
        side: 'bottom',
        before: () => runMenuAction('quick-open'),
        leave: () => runMenuAction('close-dialogs'),
      },
    ]
  },
})
