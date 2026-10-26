// Server-sent events for the editor window: `open-query` (see server/utils/editor.ts).
// A plain stream instead of h3's createEventStream, which crashes the Deno server with an
// unhandled rejection when the client disconnects.
export default defineEventHandler((event) => {
  const encoder = new TextEncoder()
  let off = () => {}
  setResponseHeaders(event, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // A first comment sends the headers right away, so the client knows it is connected.
      controller.enqueue(encoder.encode(': connected\n\n'))
      off = onOpenQuery(request => controller.enqueue(encoder.encode(`event: open-query\ndata: ${JSON.stringify(request)}\n\n`)))
    },
    cancel() {
      off()
    },
  })
})
