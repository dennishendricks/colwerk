<script setup lang="ts">
// Popover editor of one grid cell at a time, anchored at the cell; the grid calls `open` and receives `apply`.
import type { EditTarget, EditValue } from '~/utils/table-edit'

const props = defineProps<{
  target?: EditTarget
  /** Rows of the result: rows from this index on are new. */
  rowCount: number
  currentValue: (row: number, col: number) => EditValue
}>()
const emit = defineEmits<{ apply: [row: number, col: number, value: EditValue] }>()
const { t } = useI18n()

// Text and the boolean live in refs of their own, as `editing` is shallow.
const editing = shallowRef<{
  row: number
  col: number
  anchor: Element
  kind: ReturnType<typeof editorKind>
  column: NonNullable<EditTarget['columns'][number]>
}>()
const draft = ref('')
const draftBool = ref<boolean>()
function open(row: number, col: number, anchor: Element) {
  const column = props.target!.columns[col]!
  const value = props.currentValue(row, col)
  const text = 'default' in value || value.value === null ? '' : detailText(value.value)
  const kind = editorKind(column, props.target!.dialect, text)
  draft.value = text
  draftBool.value = 'value' in value && value.value !== null ? ['true', '1'].includes(text) : undefined
  editing.value = { row, col, anchor, kind, column }
}
function close() {
  editing.value = undefined
}
// `value`: NULL or DEFAULT; otherwise what the editor holds (nothing for a boolean that was not chosen).
function applyEditor(value?: EditValue) {
  const e = editing.value!
  value ??=
    e.kind !== 'boolean'
      ? { value: draft.value }
      : draftBool.value === undefined
        ? undefined
        : { value: draftBool.value }
  if (value) emit('apply', e.row, e.col, value)
  editing.value = undefined
}
defineExpose({ open, close })
</script>

<template>
  <UPopover
    :open="!!editing"
    :reference="editing?.anchor"
    :content="{ align: 'start' }"
    @update:open="(open) => open || (editing = undefined)"
  >
    <template #content>
      <form v-if="editing" class="flex w-80 flex-col gap-2 p-2" @submit.prevent="applyEditor()">
        <USelect
          v-if="editing.kind === 'boolean'"
          v-model="draftBool"
          :items="[
            { label: 'true', value: true },
            { label: 'false', value: false },
          ]"
          :aria-label="editing.column.name"
          size="xs"
        />
        <UInput
          v-else-if="editing.kind === 'date'"
          v-model="draft"
          type="date"
          :aria-label="editing.column.name"
          size="xs"
          autofocus
        />
        <UTextarea
          v-else-if="editing.kind === 'long'"
          v-model="draft"
          :rows="6"
          autoresize
          :aria-label="editing.column.name"
          size="xs"
          autofocus
          @keydown.meta.enter.prevent="applyEditor()"
          @keydown.ctrl.enter.prevent="applyEditor()"
        />
        <UInput
          v-else
          v-model="draft"
          :placeholder="/timestamp|datetime/i.test(editing.column.type) ? 'YYYY-MM-DD hh:mm:ss' : undefined"
          :aria-label="editing.column.name"
          size="xs"
          autofocus
        />
        <div class="flex justify-end gap-2">
          <UButton
            v-if="editing.column.nullable"
            label="NULL"
            size="xs"
            color="neutral"
            variant="outline"
            @click="applyEditor({ value: null })"
          />
          <UButton
            v-if="editing.row >= rowCount || canUpdateToDefault(target!.dialect)"
            label="DEFAULT"
            size="xs"
            color="neutral"
            variant="outline"
            @click="applyEditor({ default: true })"
          />
          <UButton :label="t('grid.apply')" type="submit" size="xs" />
        </div>
      </form>
    </template>
  </UPopover>
</template>
