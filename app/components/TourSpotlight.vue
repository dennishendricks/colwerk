<script setup lang="ts">
// Dims the window around the element a tour step points to; without an element (centered step) all of it
// A virtual reference (centered step) has no element to cut out.
const props = withDefaults(defineProps<{ reference?: object; padding?: number }>(), {
  reference: undefined,
  padding: 6,
})

const rect = ref<{ x: number; y: number; width: number; height: number }>()
// Each frame: the target moves with layout changes the page cannot observe (sidebar, splitters, new results).
let frame = 0
function measure() {
  const r = props.reference instanceof Element ? props.reference.getBoundingClientRect() : undefined
  const p = props.padding
  const next = r && { x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p }
  if (JSON.stringify(next) !== JSON.stringify(rect.value)) rect.value = next
  frame = requestAnimationFrame(measure)
}
onMounted(measure)
onBeforeUnmount(() => cancelAnimationFrame(frame))

// The cut-out is part of the clip path, so clicks reach the element in it and nothing else.
const clipPath = computed(() => {
  const r = rect.value
  if (!r) return 'none'
  const [l, t, rt, b] = [r.x, r.y, r.x + r.width, r.y + r.height].map((v) => `${v}px`)
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${rt} ${t}, ${rt} ${b}, ${l} ${b}, ${l} ${t})`
})
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/50 transition-[clip-path] duration-300" :style="{ clipPath }" />
  <div
    v-if="rect"
    class="pointer-events-none fixed z-40 rounded-md ring-2 ring-primary transition-all duration-300"
    :style="{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
  />
</template>
