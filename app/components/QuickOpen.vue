<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ connectionId: string; database?: string }>()
const emit = defineEmits<{ select: [schema: string, table: string] }>()

const { state, loadSchemas, loadTables } = useSchema()
const { t } = useI18n()

const target = computed(() => ({ connectionId: props.connectionId, database: props.database }))
const loading = ref(false)

// Tables of all schemas, also those the tree has not opened. Results appear as each schema arrives; the loads
// share the tree's cache and run a few at a time, so slow catalogs (lakehouse) neither block the UI nor the search.
watch(
  open,
  async (v) => {
    if (!v) return
    const tg = target.value
    loading.value = true
    try {
      if (!state(tg).schemas) await loadSchemas(tg)
      const queue = (state(tg).schemas ?? []).map((x) => x.name).filter((name) => !state(tg).tables[name])
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let name = queue.shift(); name && open.value; name = queue.shift()) await loadTables(tg, name)
        }),
      )
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

// The schema is a search key too (`suffix`), so `sales.ord` finds sales.orders.
const groups = computed((): CommandPaletteGroup[] => [
  {
    id: 'tables',
    items: Object.entries(state(target.value).tables).flatMap(([schema, tables]) =>
      tables.map((table) => ({
        label: table.name,
        suffix: schema,
        icon: table.kind === 'view' ? 'i-lucide-eye' : 'i-lucide-table-2',
        onSelect: () => {
          open.value = false
          emit('select', schema, table.name)
        },
      })),
    ),
  },
])
</script>

<template>
  <UModal v-model:open="open" :title="t('quickOpen.title')" :description="t('quickOpen.description')">
    <template #content>
      <UCommandPalette
        :groups="groups"
        :loading="loading"
        :placeholder="t('quickOpen.placeholder')"
        virtualize
        class="h-80"
        close
        @update:open="(v) => (open = v)"
      />
    </template>
  </UModal>
</template>
