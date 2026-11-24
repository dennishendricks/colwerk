<script setup lang="ts">
// Small card in the corner offering the most important tours not completed yet (INTRO_TOURS of them); app.vue
// mounts (and loads) it only while it has something to offer
const { t } = useI18n()
const { introHidden, suggested, statusOf, setStatus, start } = useTours()
const toast = useToast()

// "Don't show again" counts as completed, so the next tour moves up.
function dismiss(id: string) {
  setStatus(id, 'completed').catch((e) =>
    toast.add({
      title: t('tours.failed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    }),
  )
}
</script>

<template>
  <div
    role="dialog"
    :aria-label="t('tours.introTitle')"
    class="motion-enter fixed right-4 bottom-4 z-40 w-80 rounded-lg bg-default p-4 shadow-lg ring ring-default"
  >
    <div class="mb-2 flex items-start gap-2">
      <UIcon name="i-lucide-graduation-cap" class="mt-0.5 size-5 shrink-0 text-primary" />
      <div class="flex-1">
        <p class="text-sm font-medium">{{ t('tours.introTitle') }}</p>
        <p class="text-xs text-muted">{{ t('tours.introHint') }}</p>
      </div>
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="ghost"
        class="-m-1"
        :title="t('tours.hideIntro')"
        :aria-label="t('tours.hideIntro')"
        @click="introHidden = true"
      />
    </div>
    <ul class="space-y-1">
      <li v-for="tour in suggested" :key="tour.id" class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ t(`tours.${tour.id}.title`) }}
          <span v-if="statusOf(tour.id) === 'cancelled'" class="text-xs text-muted">
            · {{ t('tours.cancelled') }}
          </span>
        </span>
        <UButton
          icon="i-lucide-eye-off"
          size="xs"
          color="neutral"
          variant="ghost"
          :title="t('tours.dontShowAgain')"
          :aria-label="t('tours.dontShowAgain')"
          @click="dismiss(tour.id)"
        />
        <UButton icon="i-lucide-play" size="xs" variant="soft" :label="t('tours.start')" @click="start(tour)" />
      </li>
    </ul>
  </div>
</template>
