<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const shortcuts = computed(() => [
  { keys: ['meta', 'T'], label: t('shortcuts.newTab') },
  { keys: ['meta', 'W'], label: t('shortcuts.closeTab') },
  { keys: ['meta', '1–9'], label: t('shortcuts.selectTab') },
  { keys: ['meta', 'shift', 'D'], label: t('shortcuts.duplicateTab') },
  { keys: ['meta', 'O'], label: t('shortcuts.open') },
  { keys: ['meta', 'S'], label: t('shortcuts.save') },
  { keys: ['meta', 'shift', 'S'], label: t('shortcuts.saveAs') },
  { keys: ['meta', 'B'], label: t('shortcuts.sidebar') },
  { keys: ['meta', 'shift', '['], label: t('shortcuts.previousTab') },
  { keys: ['meta', 'shift', ']'], label: t('shortcuts.nextTab') },
  { keys: ['meta', 'enter'], label: t('shortcuts.run') },
  { keys: ['meta', 'shift', 'F'], label: t('shortcuts.format') },
  { keys: ['meta', 'F'], label: t('shortcuts.search') },
  { keys: ['ctrl', 'C'], label: t('shortcuts.cancel') },
  { keys: ['meta', 'E'], label: t('shortcuts.explain') },
  { keys: ['meta', 'alt', '↑/↓'], label: t('shortcuts.addCursor') },
  { keys: ['alt', t('shortcuts.drag')], label: t('shortcuts.blockSelection') },
  { keys: ['?'], label: t('shortcuts.overview') },
])
</script>

<template>
  <UModal v-model:open="open" :title="t('shortcuts.title')">
    <template #body>
      <ul class="space-y-2 text-sm">
        <li v-for="s in shortcuts" :key="s.label" class="flex items-center justify-between gap-4">
          <span>{{ s.label }}</span>
          <span class="flex gap-1">
            <UKbd v-for="k in s.keys" :key="k" :value="k" />
          </span>
        </li>
      </ul>
    </template>
  </UModal>
</template>
