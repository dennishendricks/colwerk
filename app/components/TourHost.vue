<script setup lang="ts">
// Runs a guided tour: the popover of the current step (useTour) over the spotlight. Mounted (and loaded) only while
// the tour runs, one instance per tour (app.vue).
import type { Tour } from '~/utils/tour'

const props = defineProps<{ definition: Tour }>()

const { t } = useI18n()
const toast = useToast()
const { running, setStatus } = useTours()

// Here, so the steps can use composables.
const steps = props.definition.steps()
const tour = useTour(steps)
const busy = ref(false)

/** Leaves the shown step (if any) and shows step `index`. */
async function show(index: number) {
  const step = steps[index]
  if (!step) return
  busy.value = true
  try {
    if (tour.open.value) await steps[tour.index.value]?.leave?.()
    await step.before?.()
    await nextTick()
    if (step.target) await waitForElement(step.target)
    tour.goTo(index)
  } catch (e) {
    toast.add({ title: t('tours.failed'), description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
    end('cancelled')
  } finally {
    busy.value = false
  }
}

function end(status: 'completed' | 'cancelled') {
  if (tour.open.value) Promise.resolve(steps[tour.index.value]?.leave?.()).catch(() => {})
  tour.finish()
  running.value = undefined
  setStatus(props.definition.id, status).catch(() => {})
}

const next = () => (tour.hasNext.value ? show(tour.index.value + 1) : end('completed'))

onMounted(() => show(0))

const key = computed(() => `tours.${props.definition.id}.${tour.current.value?.key}`)
</script>

<template>
  <TourSpotlight v-if="tour.open.value" :reference="tour.reference.value" />
  <!-- A new popover per step: opened after a dialog the step opened, it is the top layer and stays clickable. -->
  <UPopover
    :key="tour.index.value"
    :open="tour.open.value"
    :reference="tour.reference.value"
    :content="{ side: tour.current.value?.side, sideOffset: 16, onEscapeKeyDown: () => end('cancelled') }"
    :dismissible="false"
    :ui="{ content: 'tour-popover z-[70] w-80 p-4' }"
    arrow
  >
    <template #content>
      <!-- An open dialog would take a click here as outside and close. -->
      <div class="space-y-2" @pointerdown.stop>
        <div class="flex items-start gap-2">
          <p class="flex-1 font-medium">{{ t(`${key}.title`) }}</p>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            class="-m-1"
            :title="t('tours.cancel')"
            :aria-label="t('tours.cancel')"
            @click="end('cancelled')"
          />
        </div>
        <p class="text-sm text-muted">{{ t(`${key}.body`) }}</p>
        <div class="flex items-center gap-2 pt-1">
          <span class="text-xs text-muted">{{ tour.index.value + 1 }} / {{ tour.total.value }}</span>
          <UButton
            v-if="tour.hasPrev.value"
            :label="t('tours.back')"
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
            :disabled="busy"
            @click="show(tour.index.value - 1)"
          />
          <UButton
            :label="tour.hasNext.value ? t('tours.next') : t('tours.finish')"
            size="xs"
            :class="tour.hasPrev.value ? '' : 'ml-auto'"
            :loading="busy"
            @click="next"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
