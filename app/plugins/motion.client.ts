// Lets modals grow from the element that opened them (`.modal-motion` in main.css): the last pointer press is
// recorded and forgotten on any key, so modals opened by shortcut scale in place. Nuxt UI teleports modals into
// <body>; each one gets its origin once when it mounts, so it also closes towards the trigger after clicks inside it.
export default defineNuxtPlugin(() => {
  let pointer: PointerMark | undefined
  const options = { capture: true, passive: true }
  document.addEventListener(
    'pointerdown',
    (e) => (pointer = { x: e.clientX, y: e.clientY, at: performance.now() }),
    options,
  )
  document.addEventListener('keydown', () => (pointer = undefined), options)

  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const modal = node.matches('.modal-motion') ? node : node.querySelector<HTMLElement>('.modal-motion')
        const origin = modal && modalOrigin(pointer, performance.now(), window.innerWidth, window.innerHeight)
        if (!modal || !origin) continue
        modal.style.setProperty('--modal-origin-x', `${origin.x}px`)
        modal.style.setProperty('--modal-origin-y', `${origin.y}px`)
        modal.style.setProperty('--modal-scale', '0.5')
      }
    }
  }).observe(document.body, { childList: true })
})
