// Tour: execution plans, on the demo query (docs: editor/plans)
export default defineTour({
  id: 'execution-plans',
  category: 'editor',
  priority: 45,
  steps: () => {
    const { openTab } = useDemo()
    return [
      { key: 'explain', target: tourTarget('run'), side: 'bottom', before: () => openTab() },
      {
        key: 'plan',
        target: tourTarget('results'),
        side: 'top',
        before: async () => {
          await nextTick()
          runMenuAction('explain')
        },
      },
      { key: 'copy', target: tourTarget('plan-copy'), side: 'left' },
      { key: 'graphical' },
    ]
  },
})
