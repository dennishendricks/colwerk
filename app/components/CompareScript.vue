<script setup lang="ts">
import type { CompareSideValue } from './CompareSide.vue'

// The generated script of a compare: nothing runs automatically; it can be copied or opened in a tab of the target.
const props = defineProps<{ label: string; script: string; target: CompareSideValue; title: string }>()
const emit = defineEmits<{ opened: [] }>()

const { addTab } = useTabs()
const { t } = useI18n()
const toast = useToast()

async function copy() {
  await navigator.clipboard.writeText(props.script)
  toast.add({ title: t('compare.copied'), color: 'success', icon: 'i-lucide-check' })
}

function openInTab() {
  const tab = addTab(props.target.connectionId, props.target.database)
  tab.sql = props.script
  tab.title = props.title
  emit('opened')
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-medium">{{ label }}</h3>
      <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" :label="t('common.copy')" @click="copy" />
      <UButton
        icon="i-lucide-square-pen"
        size="xs"
        variant="ghost"
        color="neutral"
        :label="t('compare.openInTab')"
        @click="openInTab"
      />
    </div>
    <pre class="max-h-64 overflow-auto rounded border border-default bg-muted/40 p-2 font-mono text-xs">{{
      script
    }}</pre>
  </section>
</template>
