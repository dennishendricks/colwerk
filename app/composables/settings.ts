// Settings of the settings dialog, loaded once from the server (settings.json in the data directory) and shared
import { defaultSettings, type Settings } from '~~/core/settings.ts'

const settings = ref<Settings>(defaultSettings)
let loaded: Promise<void> | undefined

export function useSettings() {
  loaded ??= api<Settings>('/api/settings')
    .then((s) => void (settings.value = s))
    .catch(() => (loaded = undefined))
  const save = async (next: Settings) => {
    settings.value = await api<Settings>('/api/settings', { method: 'POST', body: next })
  }
  return { settings: readonly(settings), save }
}
