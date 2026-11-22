<script setup lang="ts">
// Picks the color that marks a connection, or none
import type { ConnectionColor } from '#core'

const color = defineModel<ConnectionColor | undefined>()
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2">
    <UButton
      size="xs"
      color="neutral"
      :variant="color ? 'ghost' : 'soft'"
      :label="t('connection.noColor')"
      :aria-pressed="!color"
      @click="color = undefined"
    />
    <button
      v-for="(c, key) in connectionColorClasses"
      :key="key"
      type="button"
      class="size-5 rounded-full ring-offset-2 ring-offset-(--ui-bg)"
      :class="[c.bg, color === key ? 'ring-2 ring-(--ui-text)' : 'hover:ring-2 hover:ring-(--ui-border-accented)']"
      :title="t(`colors.${key}`)"
      :aria-label="t(`colors.${key}`)"
      :aria-pressed="color === key"
      @click="color = key"
    />
  </div>
</template>
