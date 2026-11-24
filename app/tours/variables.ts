// Tour: queries with `${variables}`, on the demo tables (docs: editor/running-queries#variables)
export default defineTour({
  id: 'variables',
  category: 'editor',
  priority: 55,
  steps: () => {
    const { openTab, runTab } = useDemo()
    return [
      {
        key: 'syntax',
        target: tourTarget('editor'),
        side: 'bottom',
        before: () => openTab("select *\nfrom customers\nwhere city = '${city}';\n"),
      },
      {
        key: 'prompt',
        target: tourDialog(),
        side: 'bottom',
        // Not awaited: the run waits for the values.
        before: () => void runTab(),
        leave: () => {
          variablePrompt.value?.done()
          variablePrompt.value = undefined
        },
      },
      { key: 'quotes', target: tourTarget('editor'), side: 'bottom' },
    ]
  },
})
