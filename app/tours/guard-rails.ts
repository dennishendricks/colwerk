// Tour: guard rails of a production connection, on a second demo connection that has them (docs: editor/safety)
export default defineTour({
  id: 'guard-rails',
  category: 'editor',
  priority: 75,
  steps: () => {
    const { openTab, tab } = useDemo()
    const closeDialogs = () => runMenuAction('close-dialogs')
    const tryRun = async (sql: string) => {
      tab()!.sql = sql
      await nextTick()
      runMenuAction('run')
    }
    return [
      {
        key: 'color',
        target: tourTarget('toolbar'),
        side: 'bottom',
        before: () => openTab('delete from orders;\n', { variant: 'production' }),
      },
      { key: 'lint', target: tourTarget('editor'), side: 'bottom' },
      {
        key: 'unfiltered',
        target: tourDialog(),
        side: 'bottom',
        before: () => tryRun('delete from orders;\n'),
        leave: closeDialogs,
      },
      {
        key: 'confirm',
        target: tourTarget('dry-run'),
        side: 'bottom',
        before: () => tryRun("update orders set quantity = quantity + 1 where ordered_on < date '2026-03-01';\n"),
        leave: closeDialogs,
      },
      { key: 'more', target: tourTarget('toolbar'), side: 'bottom' },
    ]
  },
})
