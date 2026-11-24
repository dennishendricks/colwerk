// Tour: load data into a table with the import wizard, from a query on the demo tables (docs: data/import)
export default defineTour({
  id: 'import-data',
  category: 'data',
  priority: 40,
  steps: () => {
    const { connect } = useDemo()
    let connectionId = ''
    return [
      {
        key: 'open',
        target: tourTarget('import-data'),
        side: 'right',
        before: async () => (connectionId = await connect()),
      },
      {
        key: 'source',
        target: tourTarget('import-steps'),
        side: 'bottom',
        before: () =>
          (importRequest.value = {
            source: {
              kind: 'query',
              connectionId,
              sql: 'select c.city, count(*) as orders\nfrom orders o\njoin customers c on c.id = o.customer_id\ngroup by c.city',
            },
            target: { connectionId, schema: 'main', table: 'orders_per_city' },
          }),
      },
      {
        key: 'steps',
        target: tourTarget('import-steps'),
        side: 'bottom',
        leave: () => (importRequest.value = undefined),
      },
    ]
  },
})
