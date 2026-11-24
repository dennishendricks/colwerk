// Tour: connect an AI assistant through MCP; shown only, it needs an MCP client (docs: mcp/index, mcp/audit-log)
export default defineTour({
  id: 'mcp-setup',
  category: 'mcp',
  priority: 50,
  steps: () => [
    { key: 'intro' },
    { key: 'config', target: tourTarget('mcp-config'), side: 'right', before: () => runMenuAction('mcp') },
    { key: 'audit', target: tourTarget('mcp-audit'), side: 'top', leave: () => runMenuAction('close-dialogs') },
    { key: 'login', target: tourTarget('connections'), side: 'right' },
  ],
})
