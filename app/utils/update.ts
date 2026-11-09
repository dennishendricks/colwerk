import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

/**
 * Looks for a newer version. The desktop app installs it itself (tauri-plugin-updater: `latest.json` of the latest
 * published GitHub release, signed packages). Where that is not possible (in the browser, a package without auto
 * update such as the .deb, no `latest.json`, a failed check or installation) the release page is offered instead
 * (`offerReleasePage`). With `manual` (from the application menu) an up-to-date version or a failed check is
 * reported as well.
 */
export async function checkForUpdate(manual = false) {
  if (isDesktop) {
    try {
      const update = await check()
      if (update) offerInstall(update)
      else if (manual) upToDate()
      return
    } catch (e) {
      console.warn('Update check:', e)
    }
  }
  await offerReleasePage(manual)
}

function upToDate() {
  const { version } = useRuntimeConfig().public
  const { t } = useNuxtApp().$i18n
  useToast().add({
    title: t('update.upToDate'),
    description: t('update.installed', { version }),
    color: 'success',
    icon: 'i-lucide-check',
  })
}

function offerInstall(update: Update) {
  const { t } = useNuxtApp().$i18n
  useToast().add({
    title: t('update.available', { version: update.version }),
    description: t('update.installed', { version: update.currentVersion }),
    icon: 'i-lucide-download',
    duration: 0,
    actions: [{ label: t('update.install'), onClick: () => install(update) }],
  })
}

/**
 * Downloads (signature checked) and installs the update, then restarts the app. On Windows the installer replaces
 * the sidecar's executable, so the shell stops it first (`pause_server`); the installer then ends the app and
 * starts the new version. If installing fails there, `resume_server` starts the sidecar again and the page reloads.
 */
async function install(update: Update) {
  const toast = useToast()
  const { t } = useNuxtApp().$i18n
  const windows = navigator.userAgent.includes('Windows')
  toast.add({ id: 'update-install', title: t('update.installing'), icon: 'i-lucide-loader', duration: 0 })
  let paused = false
  try {
    await update.download()
    if (windows) {
      await invoke('pause_server')
      paused = true
    }
    await update.install()
    await relaunch()
  } catch (e) {
    if (paused) return invoke('resume_server', { error: errorMessage(e) })
    toast.remove('update-install')
    toast.add({
      title: t('update.installFailed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
      duration: 0,
      actions: [
        {
          label: t('update.download'),
          onClick: () => openUrl(`https://github.com/${useRuntimeConfig().public.repository}/releases/latest`),
        },
      ],
    })
  }
}

/**
 * Compares the app version with the latest GitHub release of the repository from package.json and offers
 * the release page if it is newer. Offline, without a release or with a private repository the request
 * fails; that is ignored unless `manual`.
 */
async function offerReleasePage(manual: boolean) {
  const { version, repository } = useRuntimeConfig().public
  const toast = useToast()
  const { t } = useNuxtApp().$i18n
  try {
    const release = await $fetch<{ tag_name: string; html_url: string }>(
      `https://api.github.com/repos/${repository}/releases/latest`,
    )
    const latest = release.tag_name.replace(/^v/, '')
    if (latest.localeCompare(version, undefined, { numeric: true }) <= 0) {
      if (manual) upToDate()
      return
    }
    toast.add({
      title: t('update.available', { version: latest }),
      description: t('update.installed', { version }),
      icon: 'i-lucide-download',
      duration: 0,
      actions: [
        {
          label: t('update.download'),
          onClick: () => openUrl(release.html_url),
        },
      ],
    })
  } catch (e) {
    // No connection, no release or repository not public: no update hint.
    if (manual) {
      toast.add({
        title: t('update.failed'),
        description: errorMessage(e),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  }
}
