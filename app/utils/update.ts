// Desktop app: the launcher opens URLs in the default browser through a binding (see launcher/main.ts).
const openUrlBinding = (window as { bindings?: { openUrl?(url: string): Promise<void> } }).bindings?.openUrl

/**
 * Compares the app version with the latest GitHub release of the repository from package.json and offers
 * the release page if it is newer. Offline, without a release or with a private repository the request
 * fails; that is ignored, unless the check was started by hand (`manual`, from the application menu).
 * Then an up-to-date version or a failed check is reported as well.
 */
export async function checkForUpdate(manual = false) {
  const { version, repository } = useRuntimeConfig().public
  const toast = useToast()
  try {
    const release = await $fetch<{ tag_name: string, html_url: string }>(`https://api.github.com/repos/${repository}/releases/latest`)
    const latest = release.tag_name.replace(/^v/, '')
    if (latest.localeCompare(version, undefined, { numeric: true }) <= 0) {
      if (manual) toast.add({ title: 'Colwerk ist aktuell', description: `Installiert ist ${version}.`, color: 'success', icon: 'i-lucide-check' })
      return
    }
    toast.add({
      title: `Colwerk ${latest} ist verfügbar`,
      description: `Installiert ist ${version}.`,
      icon: 'i-lucide-download',
      duration: 0,
      actions: [{
        label: 'Herunterladen',
        onClick: () => (openUrlBinding ? openUrlBinding(release.html_url) : window.open(release.html_url, '_blank')),
      }],
    })
  } catch (e) {
    // No connection, no release or repository not public: no update hint.
    if (manual) toast.add({ title: 'Suche nach Updates fehlgeschlagen', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
