/** One operator (`RelOp`) of a SQL Server execution plan. */
export interface PlanOperator {
  nodeId: number
  physicalOp: string
  logicalOp: string
  /** `schema.table (index)` */
  object?: string
  estimatedRows: number
  /** Only in actual plans: sum over all threads. */
  actualRows?: number
  actualExecutions?: number
  subtreeCost: number
  /** Cost of the operator itself, without its children. */
  cost: number
  /** `cost` as a share (0 to 1) of the statement cost. */
  costShare: number
  warnings: string[]
  children: PlanOperator[]
}

export interface MissingIndex {
  impact: number
  table: string
  create: string
}

export interface PlanStatement {
  text: string
  type: string
  cost: number
  /** The plan has runtime statistics (STATISTICS XML) instead of estimates only. */
  actual: boolean
  warnings: string[]
  missingIndexes: MissingIndex[]
  root?: PlanOperator
}

interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export const isShowplan = (text: string) => /<ShowPlanXML[\s>]/.test(text)

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
      : ENTITIES[e]!,
  )

/** Minimal XML parser: elements and attributes only (no text), namespace prefixes dropped. */
function parseXml(xml: string): XmlNode {
  // Comments, CDATA, declarations and doctype are skipped by the first alternatives.
  const tag =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  const local = (name: string) => name.replace(/^.*:/, '')
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  for (const [, closing, name, rest, selfClosing] of xml.matchAll(tag)) {
    if (name === undefined) continue
    if (closing) {
      if (stack.pop()?.name !== local(name)) throw new Error('Invalid XML')
      continue
    }
    const attrs: Record<string, string> = {}
    for (const [, key, dq, sq] of rest!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[local(key!)] = decode(dq ?? sq ?? '')
    }
    const node: XmlNode = { name: local(name), attrs, children: [] }
    if (stack.length) stack.at(-1)!.children.push(node)
    else if (root) throw new Error('Invalid XML')
    else root = node
    if (!selfClosing) stack.push(node)
  }
  if (!root || stack.length) throw new Error('Invalid XML')
  return root
}

const num = (value: string | undefined) => Number(value) || 0
const child = (node: XmlNode, name: string) => node.children.find((c) => c.name === name)
const children = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name)
const unbracket = (name: string | undefined) => name?.replace(/^\[|\]$/g, '')

/** The nearest descendants with the given name; does not descend into a match. */
function nearest(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((c) => (c.name === name ? [c] : nearest(c, name)))
}

/** The first `Object` element of an operator that does not belong to one of its child operators. */
function findObject(node: XmlNode): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === 'RelOp') continue
    const found = c.name === 'Object' ? c : findObject(c)
    if (found) return found
  }
}

function warningTexts(node: XmlNode | undefined): string[] {
  if (!node) return []
  const attributes = Object.entries(node.attrs)
    .filter(([, value]) => value === 'true' || value === '1')
    .map(([key]) => key)
  const elements = node.children.map(({ name, attrs, children }) => {
    switch (name) {
      case 'SpillToTempDb':
        return `${name} (level ${attrs.SpillLevel})`
      case 'PlanAffectingConvert':
        return `${name}: ${attrs.ConvertIssue}: ${attrs.Expression}`
      case 'ColumnsWithNoStatistics':
        return `${name}: ${children.map((c) => c.attrs.Column).join(', ')}`
      case 'MemoryGrantWarning':
        return `${name}: ${attrs.GrantWarningKind}`
      default:
        return name
    }
  })
  return [...attributes, ...elements]
}

function operator(node: XmlNode, statementCost: number): PlanOperator {
  const kids = nearest(node, 'RelOp').map((c) => operator(c, statementCost))
  const subtreeCost = num(node.attrs.EstimatedTotalSubtreeCost)
  const cost = Math.max(0, subtreeCost - kids.reduce((sum, c) => sum + c.subtreeCost, 0))
  const counters = children(child(node, 'RunTimeInformation') ?? node, 'RunTimeCountersPerThread')
  const obj = findObject(node)?.attrs
  const object = obj && [unbracket(obj.Schema), unbracket(obj.Table)].filter(Boolean).join('.')
  return {
    nodeId: num(node.attrs.NodeId),
    physicalOp: node.attrs.PhysicalOp ?? '',
    logicalOp: node.attrs.LogicalOp ?? '',
    object: object ? `${object}${obj.Index ? ` (${unbracket(obj.Index)})` : ''}` : undefined,
    estimatedRows: num(node.attrs.EstimateRows),
    actualRows: counters.length ? counters.reduce((sum, c) => sum + num(c.attrs.ActualRows), 0) : undefined,
    actualExecutions: counters.length ? counters.reduce((sum, c) => sum + num(c.attrs.ActualExecutions), 0) : undefined,
    subtreeCost,
    cost,
    costShare: statementCost ? cost / statementCost : 0,
    warnings: warningTexts(child(node, 'Warnings')),
    children: kids,
  }
}

function missingIndex(group: XmlNode, index: XmlNode): MissingIndex {
  const columns = (usage: string) =>
    children(index, 'ColumnGroup')
      .filter((g) => g.attrs.Usage === usage)
      .flatMap((g) => children(g, 'Column').map((c) => c.attrs.Name!))
  const keys = [...columns('EQUALITY'), ...columns('INEQUALITY')]
  const include = columns('INCLUDE')
  const { Schema, Table } = index.attrs
  const name = `ix_${unbracket(Table)}_${keys.map(unbracket).join('_')}`.slice(0, 128)
  return {
    impact: num(group.attrs.Impact),
    table: [unbracket(Schema), unbracket(Table)].join('.'),
    create:
      `create nonclustered index [${name}] on ${Schema}.${Table} (${keys.join(', ')})` +
      (include.length ? ` include (${include.join(', ')})` : ''),
  }
}

/** The statements of a SQL Server execution plan (Showplan XML, estimated or actual) in document order. */
export function parseShowplan(xml: string): PlanStatement[] {
  const document = parseXml(xml)
  if (document.name !== 'ShowPlanXML') throw new Error('Not a SQL Server execution plan')
  const statements: PlanStatement[] = []
  const visit = (node: XmlNode) => {
    const plan = child(node, 'QueryPlan')
    if (node.attrs.StatementText !== undefined && plan) {
      const rootNode = child(plan, 'RelOp')
      const cost = num(node.attrs.StatementSubTreeCost) || num(rootNode?.attrs.EstimatedTotalSubtreeCost)
      statements.push({
        text: node.attrs.StatementText.trim(),
        type: node.attrs.StatementType ?? '',
        cost,
        actual: nearest(plan, 'RunTimeInformation').length > 0,
        warnings: warningTexts(child(plan, 'Warnings')),
        missingIndexes: children(plan, 'MissingIndexes').flatMap((m) =>
          children(m, 'MissingIndexGroup').flatMap((g) => children(g, 'MissingIndex').map((i) => missingIndex(g, i))),
        ),
        root: rootNode && operator(rootNode, cost),
      })
    }
    node.children.forEach(visit)
  }
  visit(document)
  return statements
}
