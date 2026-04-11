#!/usr/bin/env bun
/**
 * Multi-Gmail & Slack MCP server for Claude Code (stdio transport).
 * State lives in ~/.claude/channels/multi-gmail/config.json.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, handleToolCall } from './tools.ts'

process.on('unhandledRejection', err => {
  process.stderr.write(`multi-gmail: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`multi-gmail: uncaught exception: ${err}\n`)
})

const server = new Server(
  { name: 'multi-gmail', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions: `This server manages multiple Google Workspace accounts (Gmail, Calendar, Drive, Docs, Sheets, Slides) and Slack workspaces.

Google tools (multi_gmail_*, gw_calendar_*, gw_drive_*, gw_docs_*, gw_sheets_*, gw_slides_*) require an account parameter — the custom name or email.
Slack tools (multi_slack_*) require a workspace parameter — the custom name or team name.

When the user doesn't specify which account/workspace:
- If only one exists, use it without asking.
- If multiple exist, ALWAYS ask the user which one before proceeding.

Label results clearly with the account/workspace name. For cross-account/workspace tools (*_all), group results accordingly.

Account and workspace management happens in the management panel at localhost:5000.`,
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params
  const args = (req.params.arguments || {}) as Record<string, unknown>
  return handleToolCall(name, args)
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('multi-gmail: MCP server started\n')
}

main().catch(err => {
  process.stderr.write(`multi-gmail: fatal error: ${err}\n`)
  process.exit(1)
})
