// Tour: write SQL faster: completion, join suggestions, lint and formatting, on the demo tables (docs: editor/index)
export default defineTour({
  id: 'editor-power',
  category: 'editor',
  priority: 65,
  steps: () => {
    const { openTab, tab } = useDemo()
    const setSql = (sql: string) => () => void (tab()!.sql = sql)
    return [
      {
        key: 'complete',
        target: tourTarget('editor'),
        side: 'bottom',
        before: () => openTab('select o.id, c.name\nfrom orders o\njoin '),
      },
      {
        key: 'lint',
        target: tourTarget('editor'),
        side: 'bottom',
        before: setSql('select id, name\nfrom orders o\njoin customers c on c.id = o.customer_id;\n'),
      },
      {
        key: 'format',
        target: tourTarget('format'),
        side: 'bottom',
        before: async () => {
          setSql(
            'select c.city, count(*) as orders from orders o join customers c on c.id = o.customer_id group by c.city;',
          )()
          await nextTick()
          runMenuAction('format')
        },
      },
      { key: 'keys', target: tourTarget('editor'), side: 'bottom' },
    ]
  },
})
