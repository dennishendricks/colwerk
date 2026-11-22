/** Where the pointer was last pressed, in viewport coordinates; `at` from `performance.now()`. */
export interface PointerMark {
  x: number
  y: number
  at: number
}

/**
 * Offset from the viewport's center of the point a modal grows from: the last pointer press, if it happened just
 * before (a click that opens the modal, also through a context menu entry). Undefined for modals opened by keyboard
 * or without user input; they scale in place.
 */
export function modalOrigin(
  pointer: PointerMark | undefined,
  now: number,
  width: number,
  height: number,
): { x: number; y: number } | undefined {
  if (!pointer || now - pointer.at > 1000) return undefined
  return { x: pointer.x - width / 2, y: pointer.y - height / 2 }
}
