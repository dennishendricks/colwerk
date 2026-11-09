<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { version, repository } = useRuntimeConfig().public
const github = `https://github.com/${repository}`

const links = computed(() => [
  { label: t('about.website'), url: websiteUrl },
  { label: t('about.repository'), url: github },
  { label: t('about.releaseNotes'), url: `${github}/releases/tag/v${version}` },
  { label: t('about.reportIssue'), url: `${github}/issues/new` },
])
</script>

<template>
  <UModal v-model:open="open" :title="t('about.title')">
    <template #body>
      <div class="flex flex-col items-center gap-3 text-center text-sm">
        <img src="/icon.svg" alt="" class="size-20" />
        <div>
          <h3 class="text-lg font-semibold">Colwerk</h3>
          <p class="text-muted">{{ t('about.version', { version }) }}</p>
        </div>
        <p>{{ t('about.tagline') }}</p>
        <div class="flex flex-wrap justify-center gap-x-1">
          <UButton
            v-for="link in links"
            :key="link.url"
            :label="link.label"
            variant="link"
            size="sm"
            @click="openUrl(link.url)"
          />
        </div>
        <p class="text-xs text-muted">© 2026 Dennis Hendricks · {{ t('about.license') }}</p>
      </div>
    </template>
  </UModal>
</template>
