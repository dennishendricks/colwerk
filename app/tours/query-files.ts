// Tour: query CSV, Parquet, JSON and Excel files with SQL; shown only, a tour has no files (docs: connections/files)
import { urlPromptOpen } from '~/composables/data-files'

export default defineTour({
  id: 'query-files',
  category: 'connections',
  priority: 58,
  steps: () => {
    const { openTab } = useDemo()
    return [
      { key: 'drop' },
      { key: 'buttons', target: tourTarget('query-file'), side: 'top', before: () => openTab('') },
      {
        key: 'url',
        target: tourDialog(),
        side: 'bottom',
        before: () => (urlPromptOpen.value = true),
        leave: () => (urlPromptOpen.value = false),
      },
      { key: 'connection', target: tourTarget('connections'), side: 'right' },
    ]
  },
})
