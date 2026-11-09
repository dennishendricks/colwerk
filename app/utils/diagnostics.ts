import { invoke } from '@tauri-apps/api/core'

/**
 * Desktop app only (Help menu): asks where to save and has the shell write version, system, sidecar state and
 * its log files there (`export_diagnostics` in src-tauri/src/main.rs), for attaching to a bug report.
 */
export async function exportDiagnostics() {
  const toast = useToast()
  const { t } = useNuxtApp().$i18n
  try {
    const path = await fileDialog('save', t('diagnostics.title'), 'colwerk-diagnostics.txt')
    if (!path) return
    await invoke('export_diagnostics', { path })
    toast.add({ title: t('diagnostics.saved'), description: path, color: 'success', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({
      title: t('diagnostics.failed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}
