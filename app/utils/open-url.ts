import { openUrl as openExternal } from '@tauri-apps/plugin-opener'
import { isDesktop } from './desktop'

export const websiteUrl = 'https://colwerk.app/'
export const privacyUrl = 'https://colwerk.app/privacy/'
export const changelogUrl = 'https://colwerk.app/changelog/'
export const docsUrl = 'https://colwerk.app/docs/start/'

/** In the desktop app the default browser opens the URL (only Colwerk's own pages, see src-tauri/capabilities). */
export function openUrl(url: string) {
  if (isDesktop) openExternal(url)
  else window.open(url, '_blank')
}
