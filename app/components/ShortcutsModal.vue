<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const list = computed(() =>
  shortcuts.map((s) => ({
    label: t(`shortcuts.${s.label}`),
    keys: s.keys.map((k) => (k === 'drag' ? t('shortcuts.drag') : k)),
  })),
)
</script>

<template>
  <UModal v-model:open="open" :title="t('shortcuts.title')">
    <template #body>
      <ul class="space-y-2 text-sm">
        <li v-for="s in list" :key="s.label" class="flex items-center justify-between gap-4">
          <span>{{ s.label }}</span>
          <span class="flex gap-1">
            <UKbd v-for="k in s.keys" :key="k" :value="k" />
          </span>
        </li>
      </ul>
    </template>
  </UModal>
</template>
