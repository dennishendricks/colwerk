// Tour: the parts of the window (docs: start/first-steps, "The window")
export default defineTour({
  id: 'window',
  category: 'start',
  priority: 100,
  steps: () => [
    { key: 'welcome' },
    { key: 'connections', target: tourTarget('connections'), side: 'right' },
    { key: 'schema', target: tourTarget('schema'), side: 'right' },
    { key: 'tabs', target: tourTarget('tab-bar'), side: 'bottom' },
    { key: 'toolbar', target: tourTarget('toolbar'), side: 'bottom' },
    { key: 'editor', target: tourTarget('editor'), side: 'bottom' },
    { key: 'results', target: tourTarget('results'), side: 'top' },
    { key: 'help' },
  ],
})
