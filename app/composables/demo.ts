// Demo database of the guided tours (core/demo.ts): prepared by the server on every tour start, so a deleted demo
// connection comes back; each tour gets one tab on it
import type { DemoVariant } from '#core'
import type { QueryTab } from './tabs'

/** The orders of the demo tables with customer and product. */
export const DEMO_SQL = `select o.id, o.ordered_on, c.name as customer, c.city, p.name as product, o.quantity,
    o.quantity * p.price as amount
from orders o
join customers c on c.id = o.customer_id
join products p on p.id = o.product_id
order by o.id;
`

/** The tutorial tab per demo connection, shared by the tours so they do not pile up tabs. */
const tutorialTabs: Record<string, string> = {}

export function useDemo() {
  const { load, activeConnectionId } = useConnections()
  const { tabs, activeTabId, addTab } = useTabs()
  const { run } = useExecution()
  const { t } = useI18n()
  let tab: QueryTab | undefined

  /**
   * Saves the demo connection again if it was deleted, creates its tables and selects it in the sidebar. The tables
   * are always created the same, so a schema the app has cached stays valid.
   */
  async function connect(variant: DemoVariant = 'default') {
    const { connectionId } = await api<{ connectionId: string }>('/api/demo', { method: 'POST', body: { variant } })
    await load()
    activeConnectionId.value = connectionId
    return connectionId
  }

  /**
   * The tutorial tab of the demo connection with `sql`, emptied of what an earlier tour left; a new one when it was
   * closed, moved to another connection or has a transaction open.
   */
  async function openTab(sql = DEMO_SQL, options: { run?: boolean; variant?: DemoVariant } = {}) {
    const connectionId = await connect(options.variant)
    const open = tabs.value.find(
      (x) => x.id === tutorialTabs[connectionId] && x.connectionId === connectionId && !x.transaction && !x.running,
    )
    tab = open ?? addTab(connectionId)
    tutorialTabs[connectionId] = tab.id
    Object.assign(tab, {
      result: undefined,
      error: undefined,
      errorAt: undefined,
      plan: undefined,
      pinned: undefined,
      viewPin: undefined,
      compare: undefined,
      resultIndex: 0,
    })
    activeTabId.value = tab.id
    tab.title = t('tours.demoTab')
    tab.sql = sql
    if (options.run) await run(tab, sql)
    return tab
  }

  /** Runs `sql` in the tour's tab; `runTab` its whole editor content. */
  const runSql = async (sql: string) => tab && run(tab, sql)
  const runTab = () => runSql(tab?.sql ?? '')

  return { connect, openTab, runTab, runSql, tab: () => tab }
}
