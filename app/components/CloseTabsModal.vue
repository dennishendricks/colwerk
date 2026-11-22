<script setup lang="ts">
// Confirms closing tabs that would lose an unsaved query or roll back an open transaction
const { closing, closingTabs, confirmClose } = useTabs()
const { t } = useI18n()

const closeDescription = computed(() => {
  const transaction = closingTabs.value.some((x) => x.transaction)
  if (closingTabs.value.length > 1) {
    return t(transaction ? 'app.closeTabsTransaction' : 'app.closeTabsQuery', { n: closingTabs.value.length })
  }
  return t(transaction ? 'app.closeTabTransaction' : 'app.closeTabQuery')
})
</script>

<template>
  <UModal
    :open="!!closing.length"
    :title="closing.length > 1 ? t('app.closeTabsTitle', { n: closing.length }) : t('app.closeTabTitle')"
    :description="closeDescription"
    :close="false"
    @update:open="(v) => !v && (closing = [])"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="closing = []" />
        <UButton :label="t('common.close')" color="error" @click="confirmClose" />
      </div>
    </template>
  </UModal>
</template>
