// Desktop app: the launcher opens URLs in the default browser through a binding (see launcher/main.ts).
const openUrlBinding = (window as { bindings?: { openUrl?(url: string): Promise<void> } }).bindings?.openUrl

export const websiteUrl = 'https://colwerk.d-hendricks.com/'
export const privacyUrl = 'https://colwerk.d-hendricks.com/privacy/'

export function openUrl(url: string) {
  if (openUrlBinding) openUrlBinding(url)
  else window.open(url, '_blank')
}
