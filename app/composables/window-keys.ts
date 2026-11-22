// Window-wide keys that defineShortcuts cannot match: zooming (⌘+ / ⌘- / ⌘0) and switching tabs (⇧⌘[ / ⇧⌘])

// Returns the zoomed font size, which the caller applies to the page.
export function useWindowKeys() {
  const { cycleTab } = useTabs()
  // ⇧⌘[ / ⇧⌘] by physical key, like macOS menus: with shift (and on other layouts) the characters differ,
  // which defineShortcuts matches on.
  const { macOS } = useKbd()
  const { size, zoomIn, zoomOut, resetZoom } = useZoom()
  function onKeydown(e: KeyboardEvent) {
    // By character, since + and = sit on different keys per layout; ⌘= is zooming in without shift.
    const zoom = { '+': zoomIn, '=': zoomIn, '-': zoomOut, '0': resetZoom }[e.key]
    if (zoom && !e.altKey && (macOS.value ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      return zoom()
    }
    const step = e.code === 'BracketLeft' ? -1 : e.code === 'BracketRight' ? 1 : 0
    if (!step || !e.shiftKey || !(macOS.value ? e.metaKey : e.ctrlKey)) return
    e.preventDefault()
    cycleTab(step)
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
  return { size }
}
