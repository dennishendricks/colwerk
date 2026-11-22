<script setup lang="ts">
// Review of a grid's pending edits as SQL; the reviewed statements are exactly the ones that run on save.
import type { CellValue } from '#core'
import type { GridEdit } from '~/composables/grid-edits'
import type { Changes } from '~/utils/table-edit'

const props = defineProps<{ edit?: GridEdit; rows: CellValue[][]; changes: Changes }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()

const reviewOpen = ref(false)
const statements = computed(() =>
  reviewOpen.value && props.edit ? editStatements(props.edit.target, props.rows, props.changes) : [],
)
const saving = ref(false)
const saveError = ref<string>()
function openReview() {
  saveError.value = undefined
  reviewOpen.value = true
}
async function save() {
  saving.value = true
  saveError.value = undefined
  try {
    await props.edit!.save(statements.value)
    emit('saved')
    reviewOpen.value = false
  } catch (e) {
    saveError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
defineExpose({ openReview })
</script>

<template>
  <UModal
    v-model:open="reviewOpen"
    :title="t('grid.reviewTitle')"
    :description="
      edit?.confirm ? t('grid.reviewDescriptionConfirm', { connection: edit.connection }) : t('grid.reviewDescription')
    "
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <UAlert
        v-if="saveError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="saveError"
        class="mb-3 whitespace-pre-wrap"
      />
      <pre class="max-h-96 overflow-auto rounded bg-elevated p-3 font-mono text-xs">{{
        statements.map((s) => `${s};`).join('\n')
      }}</pre>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="reviewOpen = false" />
        <UButton
          :label="t('grid.review')"
          :color="edit?.confirm ? 'error' : 'primary'"
          :loading="saving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
