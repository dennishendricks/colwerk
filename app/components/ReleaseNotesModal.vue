<script setup lang="ts">
// Shown once after an update (desktop app only): the release notes of the running version from GitHub, fetched by
// the server (server/api/release-notes.get.ts). The version of the last start is kept in a cookie, like the language
// (app/utils/locale.ts); on the first start there is none, so nothing is shown. If the notes cannot be loaded
// (offline, rate limit), the modal still tells about the update and links the release page, as it shows only once.
const { version, repository } = useRuntimeConfig().public
const { t } = useI18n()

const open = ref(false)
const notes = ref<string>()
const releaseUrl = `https://github.com/${repository}/releases/tag/v${version}`

const seen = useCookie<string | undefined>('colwerk-version', { maxAge: 10 * 365 * 24 * 3600 })
if (isDesktop) {
  if (seen.value && version.localeCompare(seen.value, undefined, { numeric: true }) > 0) {
    api<{ html: string }>('/api/release-notes')
      .then(({ html }) => (notes.value = html))
      .catch((e) => console.warn('Release notes:', e))
      .finally(() => (open.value = true))
  }
  seen.value = version
}

// Links open in the browser, not in the app's window.
function onClick(e: MouseEvent) {
  const link = (e.target as Element).closest('a')
  if (!link) return
  e.preventDefault()
  if (link.href) openUrl(link.href)
}
</script>

<template>
  <UModal v-model:open="open" :title="t('releaseNotes.title', { version })">
    <template #body>
      <!-- eslint-disable vue/no-v-html -- sanitized by the server (server/utils/release-notes.ts) -->
      <div
        v-if="notes"
        class="space-y-3 text-sm [&_a]:text-primary [&_a]:hover:underline [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-elevated [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
        @click="onClick"
        v-html="notes"
      />
      <!-- eslint-enable vue/no-v-html -->
      <p v-else class="text-sm text-muted">{{ t('releaseNotes.unavailable') }}</p>
    </template>
    <template #footer>
      <UButton
        :label="t('releaseNotes.release')"
        icon="i-lucide-external-link"
        color="neutral"
        variant="link"
        class="px-0"
        @click="openUrl(releaseUrl)"
      />
    </template>
  </UModal>
</template>
