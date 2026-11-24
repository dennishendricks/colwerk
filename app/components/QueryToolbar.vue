<script setup lang="ts">
// Toolbar of a query tab: connection, run and plan options, cancel, format, transaction, row limit and timeout
/* eslint-disable vue/no-mutating-props -- `tab` is the shared reactive object from useTabs(), edited in place on purpose. */
import type { ConnectionSummary, DriverStatus } from '#core'
import type { QueryTab } from '~/composables/tabs'

const props = defineProps<{
  tab: QueryTab
  connection?: ConnectionSummary
  driver?: DriverStatus
  checking: boolean
  busy: boolean
  canDryRun: boolean
}>()
const emit = defineEmits<{ execute: []; explain: [analyze?: boolean]; dryRun: []; format: [] }>()

const { connectionItems } = useConnections()
const { run, cancel } = useExecution()
const { names: lintNames, writes: lintWrites } = useLintSettings()
const { t } = useI18n()

// SQLite and ClickHouse have no plan with runtime statistics without executing the statement as usual.
const planItems = computed(() => [
  [
    { label: 'Plan', icon: 'i-lucide-list-tree', onSelect: () => emit('explain') },
    ...(props.driver?.dialect === 'sqlite' || props.driver?.dialect === 'clickhouse'
      ? []
      : [{ label: 'Analyze', icon: 'i-lucide-gauge', onSelect: () => emit('explain', true) }]),
    ...(props.canDryRun
      ? [{ label: t('query.dryRun'), icon: 'i-lucide-flask-conical', onSelect: () => emit('dryRun') }]
      : []),
  ],
  [
    {
      type: 'checkbox' as const,
      label: t('lint.checkNames'),
      checked: lintNames.value,
      onUpdateChecked: (v: boolean) => (lintNames.value = v),
    },
    {
      type: 'checkbox' as const,
      label: t('lint.checkWrites'),
      checked: lintWrites.value,
      onUpdateChecked: (v: boolean) => (lintWrites.value = v),
    },
  ],
])

// Another connection needs another session; closing the old one rolls back its open transaction, so confirm first.
const pendingConnection = ref<string>()

function selectConnection(id: string) {
  if (props.tab.transaction) pendingConnection.value = id
  else Object.assign(props.tab, { connectionId: id, database: undefined })
}

async function confirmConnection() {
  Object.assign(props.tab, { connectionId: pendingConnection.value, database: undefined, transaction: undefined })
  pendingConnection.value = undefined
  await api(`/api/tabs/${props.tab.id}`, { method: 'DELETE' }).catch(() => {})
}
</script>

<template>
  <!-- Below @4xl the buttons show icons only; scrolling remains as fallback. -->
  <div
    data-tour="toolbar"
    class="flex items-center gap-2 overflow-x-auto border-b border-default px-3 py-2"
    :class="connection?.color && ['border-l-4', connectionColorClasses[connection.color].borderLeft]"
  >
    <USelect
      :model-value="tab.connectionId"
      :items="connectionItems"
      :placeholder="t('common.selectConnection')"
      :aria-label="t('query.connection')"
      icon="i-lucide-database"
      size="sm"
      class="min-w-32 max-w-56 flex-1"
      @update:model-value="selectConnection"
    />
    <UFieldGroup size="sm" class="shrink-0" data-tour="run">
      <UButton
        icon="i-lucide-play"
        :label="t('common.run')"
        :title="t('common.run')"
        :ui="{ label: '@max-4xl:hidden' }"
        :loading="tab.running || checking"
        :disabled="!tab.connectionId || !!tab.exporting"
        @click="emit('execute')"
      />
      <UDropdownMenu :items="planItems">
        <UButton
          icon="i-lucide-chevron-down"
          :aria-label="t('query.moreOptions')"
          :disabled="!tab.connectionId || busy"
        />
      </UDropdownMenu>
    </UFieldGroup>
    <UButton
      v-if="driver?.capabilities.supportsCancel"
      icon="i-lucide-square"
      size="sm"
      :color="busy ? 'error' : 'neutral'"
      variant="soft"
      :label="t('common.cancel')"
      :title="t('common.cancel')"
      class="shrink-0"
      :ui="{ label: '@max-4xl:hidden' }"
      :disabled="!busy || tab.exporting === 'cancelled'"
      @click="cancel(tab)"
    />
    <UButton
      icon="i-lucide-wand-sparkles"
      size="sm"
      color="neutral"
      variant="ghost"
      :label="t('query.format')"
      :title="t('query.format')"
      class="shrink-0"
      :ui="{ label: '@max-4xl:hidden' }"
      :disabled="!tab.sql.trim()"
      @click="emit('format')"
    />
    <UBadge
      v-if="connection?.readOnly"
      :label="t('common.readOnly')"
      :title="t('query.readOnlyHint')"
      icon="i-lucide-lock"
      color="neutral"
      variant="subtle"
      class="shrink-0"
      :ui="{ label: '@max-4xl:hidden' }"
    />
    <template v-if="tab.transaction">
      <UBadge
        :label="tab.transaction === 'failed' ? t('common.transactionFailed') : t('common.transactionOpen')"
        :color="tab.transaction === 'failed' ? 'error' : 'warning'"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="tab.transaction === 'failed' ? t('common.transactionFailed') : t('common.transactionOpen')"
        class="motion-enter shrink-0"
        :ui="{ label: '@max-4xl:hidden' }"
      />
      <!-- A failed transaction can only be rolled back (Postgres turns COMMIT into ROLLBACK). -->
      <UButton
        v-if="tab.transaction === 'open'"
        size="sm"
        color="neutral"
        variant="soft"
        label="Commit"
        class="motion-enter shrink-0"
        :disabled="busy"
        @click="run(tab, 'COMMIT')"
      />
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        label="Rollback"
        class="motion-enter shrink-0"
        :disabled="busy"
        @click="run(tab, 'ROLLBACK')"
      />
    </template>
    <div class="ml-auto flex shrink-0 items-center gap-2 text-sm text-muted" data-tour="limits">
      <span>{{ t('query.limit') }}</span>
      <UInputNumber
        v-model="tab.rowLimit"
        :aria-label="t('query.limit')"
        :min="1"
        :max="100000"
        :step="100"
        :step-snapping="false"
        size="sm"
        class="w-32"
      />
      <span>{{ t('query.timeout') }}</span>
      <UInputNumber
        v-model="tab.timeout"
        :aria-label="t('query.timeout')"
        :min="1"
        :max="86400"
        :step="10"
        :step-snapping="false"
        size="sm"
        class="w-28"
      />
    </div>
  </div>

  <UModal
    :open="!!pendingConnection"
    :title="t('query.switchConnectionTitle')"
    :description="t('query.switchConnectionDescription')"
    :close="false"
    @update:open="(v) => !v && (pendingConnection = undefined)"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="pendingConnection = undefined" />
        <UButton :label="t('query.switchConnection')" color="error" @click="confirmConnection" />
      </div>
    </template>
  </UModal>
</template>
