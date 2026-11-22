// The shortcut overview (ShortcutsModal.vue), also the source of the shortcut reference in the documentation
// (scripts/docs-data.ts). Keys are UKbd values; `label` is a key below `shortcuts.` in i18n/locales.
export const shortcuts: { keys: string[]; label: string }[] = [
  { keys: ['meta', 'T'], label: 'newTab' },
  { keys: ['meta', 'W'], label: 'closeTab' },
  { keys: ['meta', '1–9'], label: 'selectTab' },
  { keys: ['meta', 'shift', 'D'], label: 'duplicateTab' },
  { keys: ['meta', 'O'], label: 'open' },
  { keys: ['meta', 'S'], label: 'save' },
  { keys: ['meta', 'shift', 'S'], label: 'saveAs' },
  { keys: ['meta', 'B'], label: 'sidebar' },
  { keys: ['meta', 'P'], label: 'quickOpen' },
  { keys: ['meta', '+/−/0'], label: 'zoom' },
  { keys: ['meta', 'shift', '['], label: 'previousTab' },
  { keys: ['meta', 'shift', ']'], label: 'nextTab' },
  { keys: ['←/→'], label: 'focusedTabSwitch' },
  { keys: ['F2'], label: 'focusedTabRename' },
  { keys: ['backspace'], label: 'focusedTabClose' },
  { keys: ['meta', 'enter'], label: 'run' },
  { keys: ['meta', 'shift', 'F'], label: 'format' },
  { keys: ['meta', 'F'], label: 'search' },
  { keys: ['ctrl', 'C'], label: 'cancel' },
  { keys: ['meta', 'E'], label: 'explain' },
  { keys: ['meta', 'alt', '↑/↓'], label: 'addCursor' },
  // `drag` is translated too
  { keys: ['alt', 'drag'], label: 'blockSelection' },
  { keys: ['?'], label: 'overview' },
]
