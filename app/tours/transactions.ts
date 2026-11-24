// Tour: one session per tab and its transactions, on the demo database (docs: editor/transactions)
export default defineTour({
  id: 'transactions',
  category: 'editor',
  priority: 68,
  steps: () => {
    const { openTab, runTab, runSql, tab } = useDemo()
    return [
      {
        key: 'session',
        target: tourTarget('editor'),
        side: 'bottom',
        before: () => openTab('begin;\nupdate orders set quantity = quantity * 2 where id = 1;\n'),
      },
      { key: 'open', target: tourTarget('transaction'), side: 'bottom', before: runTab },
      { key: 'tab', target: tourTarget('active-tab'), side: 'bottom' },
      { key: 'end', target: tourTarget('rollback'), side: 'bottom' },
      {
        key: 'closing',
        // Rolls back what the tour left open, unless the user already ended the transaction.
        before: () => tab()?.transaction && runSql('rollback'),
      },
    ]
  },
})
