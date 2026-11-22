import type { ImportSource } from '#core'

// Data import wizard (DataImportModal): what it was opened with; `undefined` while closed.
export interface ImportRequest {
  source?: ImportSource
  target?: { connectionId?: string; database?: string; schema?: string; table?: string }
}

export const importRequest = ref<ImportRequest>()

export function useImport() {
  return { openImport: (r: ImportRequest = {}) => (importRequest.value = r) }
}
