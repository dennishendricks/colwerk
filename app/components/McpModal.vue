<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const bridge = ref<{ command: string, args: string[] }>()
watch(open, async (v) => {
  if (v && !bridge.value) bridge.value = await api('/api/mcp')
}, { immediate: true })

const json = computed(() => bridge.value && JSON.stringify({ mcpServers: { colwerk: bridge.value } }, null, 2))
const cli = computed(() => bridge.value && [bridge.value.command, ...bridge.value.args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '))
const toml = computed(() => bridge.value && `[mcp_servers.colwerk]\ncommand = ${JSON.stringify(bridge.value.command)}\nargs = ${JSON.stringify(bridge.value.args)}`)
</script>

<template>
  <UModal v-model:open="open" :title="$t('mcp.title')" :description="$t('mcp.description')">
    <template #body>
      <div v-if="bridge" class="space-y-4 text-sm">
        <section class="space-y-1">
          <h3 class="font-medium">Claude Desktop</h3>
          <i18n-t keypath="mcp.claudeDesktop" tag="p" class="text-muted">
            <template #file><code>claude_desktop_config.json</code></template>
          </i18n-t>
          <pre class="overflow-x-auto rounded bg-elevated p-2 text-xs select-all">{{ json }}</pre>
        </section>
        <section class="space-y-1">
          <h3 class="font-medium">Claude Code</h3>
          <pre class="overflow-x-auto rounded bg-elevated p-2 text-xs select-all">claude mcp add colwerk -- {{ cli }}</pre>
        </section>
        <section class="space-y-1">
          <h3 class="font-medium">ChatGPT / Codex</h3>
          <i18n-t keypath="mcp.codex" tag="p" class="text-muted">
            <template #file><code>~/.codex/config.toml</code></template>
          </i18n-t>
          <pre class="overflow-x-auto rounded bg-elevated p-2 text-xs select-all">codex mcp add colwerk -- {{ cli }}</pre>
          <pre class="overflow-x-auto rounded bg-elevated p-2 text-xs select-all">{{ toml }}</pre>
        </section>
        <p class="text-muted">{{ $t('mcp.others') }}</p>
      </div>
    </template>
  </UModal>
</template>
