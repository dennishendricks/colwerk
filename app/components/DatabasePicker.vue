<script setup lang="ts">
const { connections, activeConnectionId, activeDatabase, driverOf } = useWorkspace()
const { state, loadDatabases } = useSchema()

const connection = computed(() => connections.value.find(c => c.id === activeConnectionId.value))
const supported = computed(() => !!driverOf(activeConnectionId.value)?.capabilities.supportsDatabases)
const s = computed(() => connection.value ? state({ connectionId: connection.value.id }) : undefined)

watch([activeConnectionId, supported], ([id, ok]) => {
  if (id && ok && !state({ connectionId: id }).databases) loadDatabases(id)
}, { immediate: true })

// The database configured in the connection is the default; it stays selectable even if the list leaves it out.
const items = computed(() => {
  const names = s.value?.databases?.map(d => d.name) ?? []
  const fallback = connection.value?.database
  return fallback && !names.includes(fallback) ? [fallback, ...names] : names
})

const selected = computed({
  get: () => activeDatabase.value ?? connection.value?.database,
  set: name => (activeDatabase.value = name === connection.value?.database ? undefined : name),
})
</script>

<template>
  <!-- Reloaded on every open, so databases created in the meantime show up. -->
  <USelectMenu
    v-if="connection && supported"
    v-model="selected"
    :items="items"
    :loading="s?.loading.databases"
    :placeholder="$t('connection.defaultDatabase')"
    icon="i-lucide-database"
    class="w-full"
    @update:open="open => open && loadDatabases(connection!.id, true)"
  />
</template>
