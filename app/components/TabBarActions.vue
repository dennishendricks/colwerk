<script setup lang="ts">
// The buttons at the right end of the tab bar: compare, history, MCP setup, color mode, shortcuts and about
const emit = defineEmits<{ compare: []; history: []; mcp: []; shortcuts: []; about: [] }>()
const { t } = useI18n()

// Toggles between the system setting and its opposite; the opposite is stored as a fixed mode (localStorage),
// so it no longer differs from the system once the system setting changes.
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')
const colorModeLabel = computed(() =>
  colorMode.preference !== 'system' ? t('app.systemDesign') : isDark.value ? t('app.lightDesign') : t('app.darkDesign'),
)
</script>

<template>
  <UButton
    icon="i-lucide-git-compare"
    size="xs"
    variant="ghost"
    color="neutral"
    class="ml-auto"
    :title="t('compare.open')"
    :aria-label="t('compare.open')"
    @click="emit('compare')"
  />
  <UButton
    icon="i-lucide-history"
    size="xs"
    variant="ghost"
    color="neutral"
    :title="t('app.history')"
    :aria-label="t('app.history')"
    @click="emit('history')"
  />
  <!-- In the desktop app it is in the application menu. -->
  <UButton
    v-if="!isDesktop"
    icon="i-lucide-sparkles"
    size="xs"
    variant="ghost"
    color="neutral"
    :title="t('app.setupMcp')"
    :aria-label="t('app.setupMcp')"
    @click="emit('mcp')"
  />
  <UButton
    :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
    size="xs"
    variant="ghost"
    color="neutral"
    :title="colorModeLabel"
    :aria-label="colorModeLabel"
    @click="colorMode.preference = colorMode.preference !== 'system' ? 'system' : isDark ? 'light' : 'dark'"
  />
  <UButton
    icon="i-lucide-keyboard"
    size="xs"
    variant="ghost"
    color="neutral"
    :title="t('app.shortcuts')"
    :aria-label="t('app.shortcuts')"
    @click="emit('shortcuts')"
  />
  <!-- In the desktop app it is in the application menu. -->
  <UButton
    v-if="!isDesktop"
    icon="i-lucide-info"
    size="xs"
    variant="ghost"
    color="neutral"
    :title="t('app.about')"
    :aria-label="t('app.about')"
    @click="emit('about')"
  />
</template>
