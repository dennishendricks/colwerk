<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const shortcuts = [
  { keys: ['meta', 'T'], label: 'Neuer Tab' },
  { keys: ['meta', 'W'], label: 'Aktuellen Tab schließen' },
  { keys: ['meta', '1–9'], label: 'Zu Tab 1–9 wechseln' },
  { keys: ['meta', 'shift', 'D'], label: 'Aktuellen Tab duplizieren' },
  { keys: ['meta', 'O'], label: 'Abfrage aus Datei öffnen' },
  { keys: ['meta', 'S'], label: 'Abfrage speichern' },
  { keys: ['meta', 'shift', 'S'], label: 'Abfrage speichern unter' },
  { keys: ['meta', 'B'], label: 'Seitenleiste ein-/ausblenden' },
  { keys: ['meta', 'shift', '['], label: 'Zum vorherigen Tab wechseln' },
  { keys: ['meta', 'shift', ']'], label: 'Zum nächsten Tab wechseln' },
  { keys: ['meta', 'enter'], label: 'Abfrage ausführen (im Editor)' },
  { keys: ['meta', 'shift', 'F'], label: 'SQL formatieren' },
  { keys: ['meta', 'F'], label: 'Suchen (in Editor, Ergebnis oder Schema)' },
  { keys: ['ctrl', 'C'], label: 'Laufende Abfrage abbrechen' },
  { keys: ['meta', 'E'], label: 'Ausführungsplan anzeigen (im Editor)' },
  { keys: ['meta', 'alt', '↑/↓'], label: 'Cursor darüber/darunter hinzufügen (im Editor)' },
  { keys: ['alt', 'Ziehen'], label: 'Blockauswahl über mehrere Zeilen (im Editor)' },
  { keys: ['?'], label: 'Shortcut-Übersicht anzeigen' },
]
</script>

<template>
  <UModal v-model:open="open" title="Tastenkürzel">
    <template #body>
      <ul class="space-y-2 text-sm">
        <li v-for="s in shortcuts" :key="s.label" class="flex items-center justify-between gap-4">
          <span>{{ s.label }}</span>
          <span class="flex gap-1">
            <UKbd v-for="k in s.keys" :key="k" :value="k" />
          </span>
        </li>
      </ul>
    </template>
  </UModal>
</template>
