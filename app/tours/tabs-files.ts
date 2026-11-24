// Tour: tabs, query files and windows (docs: editor/tabs)
export default defineTour({
  id: 'tabs-files',
  category: 'editor',
  priority: 50,
  steps: () => {
    const { openTab } = useDemo()
    return [
      { key: 'rename', target: tourTarget('active-tab'), side: 'bottom', before: () => openTab() },
      { key: 'duplicate', target: tourTarget('active-tab'), side: 'bottom' },
      { key: 'menu', target: tourTarget('active-tab'), side: 'bottom' },
      { key: 'files', target: tourTarget('tab-bar'), side: 'bottom' },
      { key: 'restore' },
    ]
  },
})
