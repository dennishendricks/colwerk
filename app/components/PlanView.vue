<script setup lang="ts">
const props = defineProps<{ xml: string }>()

const { t, locale } = useI18n()
const toast = useToast()

const parsed = computed(() => {
  try {
    return { statements: parseShowplan(props.xml) }
  } catch (e) {
    return { error: errorMessage(e) }
  }
})

// Collapsed operators, keyed by statement index and node id.
const collapsed = reactive(new Set<string>())
const keyOf = (statement: number, op: PlanOperator) => `${statement}:${op.nodeId}`
function toggle(key: string) {
  if (!collapsed.delete(key)) collapsed.add(key)
}

function rows(statement: number, root?: PlanOperator) {
  const out: { op: PlanOperator; depth: number; key: string }[] = []
  const walk = (op: PlanOperator, depth: number) => {
    const key = keyOf(statement, op)
    out.push({ op, depth, key })
    if (!collapsed.has(key)) op.children.forEach((c) => walk(c, depth + 1))
  }
  if (root) walk(root, 0)
  return out
}

const number = (n: number) => n.toLocaleString(locale.value)
const cost = (n: number) => n.toLocaleString(locale.value, { maximumSignificantDigits: 4 })
const percent = (share: number) => `${Math.round(share * 100)} %`
// An estimate that is off by a factor of 10 or more.
const misestimated = (op: PlanOperator) =>
  op.actualRows !== undefined &&
  Math.max(op.actualRows, op.estimatedRows) >= 10 * Math.min(op.actualRows, op.estimatedRows)

async function copyIndex(create: string) {
  await navigator.clipboard.writeText(create)
  toast.add({ title: t('plan.indexCopied'), color: 'success', icon: 'i-lucide-check' })
}
</script>

<template>
  <div class="h-full space-y-4 overflow-auto p-3">
    <UAlert
      v-if="parsed.error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="t('plan.invalid')"
      :description="parsed.error"
    />
    <p v-else-if="!parsed.statements?.length" class="text-muted text-sm">{{ t('plan.noOperators') }}</p>
    <section v-for="(statement, i) in parsed.statements" :key="i" class="space-y-2">
      <div class="flex items-start gap-2">
        <p class="line-clamp-2 min-w-0 flex-1 font-mono text-xs" :title="statement.text">{{ statement.text }}</p>
        <span class="text-muted shrink-0 text-xs">{{ t('plan.statementCost', { cost: cost(statement.cost) }) }}</span>
        <UBadge
          :label="statement.actual ? t('plan.actual') : t('plan.estimated')"
          color="neutral"
          variant="subtle"
          size="sm"
        />
      </div>
      <UAlert
        v-if="statement.warnings.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('plan.warnings')"
        :description="statement.warnings.join('\n')"
        class="whitespace-pre-wrap"
      />
      <UAlert
        v-for="index in statement.missingIndexes"
        :key="index.create"
        color="info"
        variant="subtle"
        icon="i-lucide-lightbulb"
        :title="t('plan.missingIndex', { impact: index.impact })"
      >
        <template #description>
          <div class="flex items-start gap-2">
            <pre class="min-w-0 flex-1 overflow-x-auto font-mono text-xs">{{ index.create }}</pre>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="ghost"
              :title="t('common.copy')"
              :aria-label="t('common.copy')"
              @click="copyIndex(index.create)"
            />
          </div>
        </template>
      </UAlert>
      <table v-if="statement.root" class="w-full text-xs">
        <thead class="text-muted text-left">
          <tr>
            <th class="py-1 font-medium">{{ t('plan.operator') }}</th>
            <th class="py-1 font-medium">{{ t('plan.object') }}</th>
            <th class="py-1 font-medium">{{ t('plan.cost') }}</th>
            <th class="py-1 text-right font-medium">{{ t('plan.estimatedRows') }}</th>
            <th v-if="statement.actual" class="py-1 text-right font-medium">{{ t('plan.actualRows') }}</th>
            <th class="py-1 text-right font-medium">{{ t('plan.subtreeCost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ op, depth, key } in rows(i, statement.root)" :key="key" class="border-default border-t">
            <td class="py-1">
              <div class="flex items-center gap-1" :style="{ paddingLeft: `${depth}rem` }">
                <UButton
                  v-if="op.children.length"
                  :icon="collapsed.has(key) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :aria-expanded="!collapsed.has(key)"
                  :aria-label="collapsed.has(key) ? t('plan.expand') : t('plan.collapse')"
                  @click="toggle(key)"
                />
                <span v-else class="size-6 shrink-0" />
                <span>
                  {{ op.physicalOp }}<template v-if="op.logicalOp !== op.physicalOp"> ({{ op.logicalOp }})</template>
                </span>
                <UIcon
                  v-if="op.warnings.length"
                  name="i-lucide-triangle-alert"
                  class="text-warning shrink-0"
                  :title="op.warnings.join('\n')"
                />
              </div>
            </td>
            <td class="py-1 font-mono">{{ op.object }}</td>
            <td class="py-1">
              <div class="flex items-center gap-2" :class="op.costShare >= 0.25 && 'text-warning font-semibold'">
                <span class="bg-default inline-block h-2 w-16 shrink-0 overflow-hidden rounded-sm">
                  <span class="bg-primary block h-full" :style="{ width: `${Math.round(op.costShare * 100)}%` }" />
                </span>
                {{ percent(op.costShare) }}
              </div>
            </td>
            <td class="py-1 text-right tabular-nums">{{ number(op.estimatedRows) }}</td>
            <td
              v-if="statement.actual"
              class="py-1 text-right tabular-nums"
              :class="misestimated(op) && 'text-warning'"
            >
              {{ op.actualRows === undefined ? '' : number(op.actualRows) }}
            </td>
            <td class="py-1 text-right tabular-nums">{{ cost(op.subtreeCost) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
