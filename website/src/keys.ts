// Keyboard shortcuts in the documentation: `:kbd[meta+shift+D]` in Markdown becomes both the macOS notation (⇧⌘D) and
// the Windows/Linux one (Ctrl+Shift+D). Head.astro marks Apple devices, theme.css hides the other notation.
import type { satteri } from '@astrojs/markdown-satteri'

// Key names of app/utils/shortcuts.ts (UKbd values) on macOS and on Windows/Linux, modifiers in each one's usual order
const mac: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘', enter: 'Enter', backspace: '⌫' }
const other: Record<string, string> = {
  ctrl: 'Ctrl',
  meta: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
}
const modifiers = ['ctrl', 'alt', 'shift', 'meta']
const otherOrder = ['ctrl', 'meta', 'alt', 'shift']

/** The notations of a shortcut on macOS (⇧⌘D) and on Windows/Linux (Ctrl+Shift+D). */
export function formatKeys(names: string[]): { mac: string; other: string } {
  const rest = names.filter((k) => !modifiers.includes(k))
  const macMods = modifiers.filter((m) => names.includes(m)).map((m) => mac[m])
  const macRest = rest.map((k) => mac[k] ?? k).join('')
  // A mouse action is set apart from the modifier symbols: ⌥ drag
  const space = macMods.length && /^(click|drag)$/i.test(macRest) ? ' ' : ''
  return {
    mac: macMods.join('') + space + macRest,
    other: [...otherOrder.filter((m) => names.includes(m)), ...rest].map((k) => other[k] ?? k).join('+'),
  }
}

type MdastPlugin = NonNullable<NonNullable<Parameters<typeof satteri>[0]>['mdastPlugins']>[number]

// Custom node types become elements named by `data.hName`, in .md as well as .mdx
const kbd = (className: string, value: string) => ({
  type: 'kbd',
  data: { hName: 'kbd', hProperties: { className: [className] } },
  children: [{ type: 'text' as const, value }],
})

/** Sätteri plugin: `:kbd[meta+shift+Z]` becomes both notations; `{other="Ctrl+Y"}` sets the Windows/Linux one. */
export const kbdPlugin: MdastPlugin = {
  name: 'colwerk-kbd',
  textDirective(node, ctx) {
    if (node.name !== 'kbd') return
    // `meta++` is ⌘ and the plus key
    const { mac, other } = formatKeys(ctx.textContent(node).split(/\+(?=.)/))
    ctx.replaceNode(node, {
      type: 'span',
      data: { hName: 'span', hProperties: { className: ['kbd'] } },
      children: [kbd('mac', mac), kbd('other', node.attributes?.other ?? other)],
    })
  },
}
