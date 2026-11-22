import { findImportFile, importSources } from '#core'

// The default file of each source, null if it is not there.
export default defineEventHandler(() =>
  importSources.map((source) => ({ source, path: findImportFile(source) ?? null })),
)
