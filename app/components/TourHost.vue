<script setup lang="ts">
// Runs the guided tour chosen in useTours(): the popover of the current step (useTour) over the spotlight
import type { TourStep } from '~/utils/tour'

const { t } = useI18n()
const toast = useToast()
const { running, setStatus } = useTours()

// Once here, so the tours' steps can use composables.
const prepared = Object.fromEntries(tours.map((tour) => [tour.id, tour.steps()]))
const steps = computed<TourStep[]>(() => (running.value ? (prepared[running.value] ?? []) : []))
const tour = useTour(steps)
const busy = ref(false)

/** Waits up to 3 s for the step's target to appear, e.g. the grid of a query just run. */
async function waitForTarget(step: TourStep) {
  for (let i = 0; step.target && !step.target() && i < 180; i++)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}

async function show(index: number) {
  const step = steps.value[index]
  if (!step) return
  busy.value = true
  try {
    await step.before?.()
    await nextTick()
    await waitForTarget(step)
    tour.goTo(index)
  } catch (e) {
    toast.add({ title: t('tours.failed'), description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
    end('cancelled')
  } finally {
    busy.value = false
  }
}

function end(status: 'completed' | 'cancelled') {
  const id = running.value
  tour.finish()
  running.value = undefined
  if (id) setStatus(id, status).catch(() => {})
}

const next = () => (tour.hasNext.value ? show(tour.index.value + 1) : end('completed'))

watch(running, (id) => id && show(0))

const key = computed(() => `tours.${running.value}.${tour.current.value?.key}`)
</script>

<template>
  <TourSpotlight v-if="tour.open.value" :reference="tour.reference.value" />
  <UPopover
    :open="tour.open.value"
    :reference="tour.reference.value"
    :content="{ side: tour.current.value?.side, sideOffset: 16, onEscapeKeyDown: () => end('cancelled') }"
    :dismissible="false"
    :ui="{ content: 'z-50 w-80 p-4' }"
    arrow
  >
    <template #content>
      <div class="space-y-2">
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
            @click="tour.prev()"
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
