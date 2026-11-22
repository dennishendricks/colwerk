import type { ServerSession } from '../../core/types.ts'

export interface BlockingNode {
  session: ServerSession
  /** Sessions waiting for this one. */
  blocked: BlockingNode[]
}

const byId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Ids of the sessions some other session waits for. */
export const blockers = (sessions: ServerSession[]): Set<string> => new Set(sessions.flatMap((s) => s.blockedBy))

/**
 * The sessions waiting for locks as trees, below the session at the head of each chain. A blocker that is not in
 * the list (e.g. another user's session without permission to see it) becomes a placeholder head. Of a cycle
 * (deadlock) the smallest id is the head; every session appears once.
 */
export function blockingChains(sessions: ServerSession[]): BlockingNode[] {
  const known = new Map(sessions.map((s) => [s.id, s]))
  const missing = (id: string): ServerSession => ({
    id,
    user: null,
    database: null,
    client: null,
    application: null,
    state: null,
    active: true,
    seconds: null,
    query: null,
    wait: null,
    blockedBy: [],
  })
  const visited = new Set<string>()
  const build = (session: ServerSession): BlockingNode => {
    visited.add(session.id)
    const blocked: BlockingNode[] = []
    for (const s of sessions) if (s.blockedBy.includes(session.id) && !visited.has(s.id)) blocked.push(build(s))
    return { session, blocked }
  }
  const pending = [...blockers(sessions)].sort(byId)
  const heads = pending.filter((id) => !known.get(id)?.blockedBy.length)
  const chains = heads.map((id) => build(known.get(id) ?? missing(id)))
  // What is left lies in cycles.
  for (const id of pending) if (!visited.has(id)) chains.push(build(known.get(id)!))
  return chains
}
