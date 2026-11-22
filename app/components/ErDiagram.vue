<script setup lang="ts">
import { ER_BOX, type ErEdge, type ErLayout, type ErNode } from '~/utils/er-model'

const props = defineProps<{ layout: ErLayout; label: string }>()
const emit = defineEmits<{ open: [schema: string, table: string] }>()

const { header, row, char, pad } = ER_BOX
const MARGIN = 24
const MIN_ZOOM = 0.2
const MAX_ZOOM = 3

const svg = useTemplateRef('svg')
// The visible part of the diagram in diagram units; its shape follows the element's, so one unit is
// `scale` pixels both ways.
const view = reactive({ x: 0, y: 0, w: 100, h: 100 })
const viewBox = computed(() => `${view.x} ${view.y} ${view.w} ${view.h}`)
const hover = ref<string>()
const dragging = ref(false)

function size() {
  const r = svg.value!.getBoundingClientRect()
  return { w: r.width || 1, h: r.height || 1, left: r.left, top: r.top }
}

const scaleOf = (c: { w: number; h: number }) => Math.max(view.w / c.w, view.h / c.h)

/** Centers the whole diagram, at most at its natural size. */
function fit() {
  if (!svg.value) return
  const c = size()
  const { width, height } = props.layout
  const scale = Math.min(1 / MIN_ZOOM, Math.max(1, (width + 2 * MARGIN) / c.w, (height + 2 * MARGIN) / c.h))
  Object.assign(view, { w: c.w * scale, h: c.h * scale })
  view.x = (width - view.w) / 2
  view.y = (height - view.h) / 2
}

/** Zooms by `factor` around the pixel (px, py) of the element. */
function zoomAt(factor: number, px: number, py: number) {
  const c = size()
  const scale = scaleOf(c)
  const next = 1 / Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor / scale))
  const [ux, uy] = [view.x + px * scale, view.y + py * scale]
  Object.assign(view, { w: c.w * next, h: c.h * next, x: ux - px * next, y: uy - py * next })
}

const zoomBy = (factor: number) => zoomAt(factor, size().w / 2, size().h / 2)
defineExpose({ fit, zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8) })

function onWheel(e: WheelEvent) {
  const c = size()
  zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - c.left, e.clientY - c.top)
}

// Dragging pans. The pointer is only captured once it moved, so a double-click still reaches the table.
let drag: { x: number; y: number; moved: boolean } | undefined
function onDown(e: PointerEvent) {
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: false }
}
function onMove(e: PointerEvent) {
  if (!drag) return
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
    drag.moved = dragging.value = true
    svg.value!.setPointerCapture(e.pointerId)
  }
  const scale = scaleOf(size())
  view.x -= (e.clientX - drag.x) * scale
  view.y -= (e.clientY - drag.y) * scale
  drag.x = e.clientX
  drag.y = e.clientY
}
function onUp() {
  drag = undefined
  dragging.value = false
}

// The first size is only known once the element is laid out (a modal animates open).
let fitted = false
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (fitted || !svg.value?.clientWidth) return
    fitted = true
    fit()
  })
  observer.observe(svg.value!)
})
onBeforeUnmount(() => observer?.disconnect())
watch(
  () => props.layout,
  () => nextTick(fit),
)

/** `text` cut to `max` characters. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

const room = (node: ErNode) => Math.floor((node.width - 2 * pad) / char)

function headerPath(node: ErNode) {
  return `M0 ${header} V4 a4 4 0 0 1 4 -4 H${node.width - 4} a4 4 0 0 1 4 4 V${header} Z`
}

const active = (edge: ErEdge) => !!hover.value && (edge.from === hover.value || edge.to === hover.value)
const rowY = (i: number) => header + row * (i + 0.5)
const mark = (name: string, edge: ErEdge) => `url(#er-${name}${active(edge) ? '-hi' : ''})`
</script>

<template>
  <svg
    ref="svg"
    role="img"
    :aria-label="label"
    class="size-full touch-none select-none"
    :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
    :viewBox="viewBox"
    preserveAspectRatio="xMinYMin meet"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @wheel.prevent="onWheel"
  >
    <defs>
      <!-- Drawn backwards from the end of the line; `auto-start-reverse` mirrors them at the start. -->
      <template v-for="hi in [false, true]" :key="String(hi)">
        <g fill="none" stroke-width="1.5" :stroke="hi ? 'var(--ui-primary)' : 'var(--ui-text-muted)'">
          <marker
            :id="`er-many${hi ? '-hi' : ''}`"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
            viewBox="-16 -8 18 16"
            markerWidth="18"
            markerHeight="16"
            refX="0"
            refY="0"
          >
            <path d="M -12 0 L 0 -6 M -12 0 L 0 0 M -12 0 L 0 6" />
          </marker>
          <marker
            :id="`er-one${hi ? '-hi' : ''}`"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
            viewBox="-16 -8 18 16"
            markerWidth="18"
            markerHeight="16"
            refX="0"
            refY="0"
          >
            <path d="M -6 -6 L -6 6 M -10 -6 L -10 6" />
          </marker>
          <marker
            :id="`er-zero-one${hi ? '-hi' : ''}`"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
            viewBox="-16 -8 18 16"
            markerWidth="18"
            markerHeight="16"
            refX="0"
            refY="0"
          >
            <path d="M -6 -6 L -6 6" />
            <circle cx="-12" cy="0" r="4" fill="var(--ui-bg)" />
          </marker>
        </g>
      </template>
    </defs>

    <path
      v-for="(edge, i) in layout.edges"
      :key="i"
      :d="edge.path"
      fill="none"
      stroke-width="1.5"
      :stroke="active(edge) ? 'var(--ui-primary)' : 'var(--ui-text-muted)'"
      :marker-start="mark('many', edge)"
      :marker-end="mark(edge.relation.optional ? 'zero-one' : 'one', edge)"
    />

    <g
      v-for="node in layout.nodes"
      :key="node.key"
      :transform="`translate(${node.x} ${node.y})`"
      class="cursor-pointer"
      @pointerenter="hover = node.key"
      @pointerleave="hover = undefined"
      @dblclick="emit('open', node.table.schema, node.table.name)"
    >
      <title>{{ node.key }}</title>
      <rect
        :width="node.width"
        :height="node.height"
        rx="4"
        fill="var(--ui-bg)"
        stroke="var(--ui-border-accented)"
        :stroke-dasharray="node.table.stub ? '4 3' : undefined"
      />
      <path :d="headerPath(node)" fill="var(--ui-bg-elevated)" />
      <text
        :x="pad"
        :y="header / 2"
        dominant-baseline="central"
        font-size="12"
        font-weight="600"
        fill="var(--ui-text-highlighted)"
        style="font-family: var(--font-mono)"
      >
        {{ clip(node.table.name, room(node)) }}
      </text>
      <g v-for="(c, i) in node.columns" :key="c.name" font-size="12" style="font-family: var(--font-mono)">
        <text
          :x="pad"
          :y="rowY(i)"
          dominant-baseline="central"
          :font-weight="c.pk ? 700 : 400"
          :fill="c.fk ? 'var(--ui-info)' : 'var(--ui-text)'"
        >
          {{ clip(c.name, room(node) - Math.min(c.type.length, 12) - 1) }}
        </text>
        <text
          :x="node.width - pad"
          :y="rowY(i)"
          text-anchor="end"
          dominant-baseline="central"
          fill="var(--ui-text-muted)"
        >
          {{ clip(c.type, 12) }}
        </text>
      </g>
    </g>
  </svg>
</template>
