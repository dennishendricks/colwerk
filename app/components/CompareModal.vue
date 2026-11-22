<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const tab = ref('schema')
const items = computed(() => [
  { label: t('compare.schema'), value: 'schema', icon: 'i-lucide-table-properties' },
  { label: t('compare.data'), value: 'data', icon: 'i-lucide-rows-3' },
])
</script>

<template>
  <UModal v-model:open="open" fullscreen :title="t('compare.title')" :description="t('compare.description')">
    <template #body>
      <div class="mx-auto max-w-5xl space-y-4">
        <UTabs v-model="tab" :items="items" :content="false" />
        <!-- Both stay mounted, so that switching keeps the choices and the result. -->
        <CompareSchema v-show="tab === 'schema'" @close="open = false" />
        <CompareData v-show="tab === 'data'" @close="open = false" />
      </div>
    </template>
  </UModal>
</template>
