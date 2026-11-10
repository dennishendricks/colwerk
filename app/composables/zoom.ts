const DEFAULT_SIZE = 13
const MIN_SIZE = 10
const MAX_SIZE = 24

/**
 * Font size of the editor and the result grid, set as CSS variable on the page (app.vue). A cookie,
 * since localStorage is tied to the port, which the desktop app picks anew on every start.
 */
export function useZoom() {
  const size = useCookie<number>('colwerk-font-size', { default: () => DEFAULT_SIZE, maxAge: 10 * 365 * 24 * 3600 })
  const step = (by: number) => (size.value = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(size.value) + by)))
  return { size, zoomIn: () => step(1), zoomOut: () => step(-1), resetZoom: () => (size.value = DEFAULT_SIZE) }
}
