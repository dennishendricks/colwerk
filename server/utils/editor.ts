// Pushes requests from the server to open editor windows (via /api/events), e.g. a query
// prepared by an MCP client.

export interface OpenQueryRequest {
  connectionId: string
  sql: string
  title?: string
}

const listeners = new Set<(request: OpenQueryRequest) => void>()

export function onOpenQuery(listener: (request: OpenQueryRequest) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Returns the number of windows that received the request. */
export function openQuery(request: OpenQueryRequest): number {
  for (const listener of listeners) listener(request)
  return listeners.size
}
