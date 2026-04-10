#!/usr/bin/env bun
/**
 * Google Workspace MCP server for Claude Code.
 *
 * Manages multiple Google accounts with custom names.
 * Services: Gmail, Calendar, Docs, Sheets, Slides, Drive.
 * State lives in ~/.claude/channels/google-workspace/config.json.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { tools, handleToolCall } from './tools.ts'

process.on('unhandledRejection', err => {
  process.stderr.write(`google-workspace: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`google-workspace: uncaught exception: ${err}\n`)
})

const server = new Server(
  { name: 'google-workspace', version: '0.2.0' },
  {
    capabilities: { tools: {} },
    instructions: `Google Workspace manages multiple Google accounts. Every tool requires an account parameter — the custom name or email.

When the user doesn't specify which account:
- If only one account exists, use it without asking.
- If multiple exist, ALWAYS ask the user which account before proceeding.

Label results clearly with the account name and email. For cross-account tools (_all variants), group results by account.

Account management (add, remove, rename) happens in the management panel at localhost:5000.`,
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params
  const args = (req.params.arguments || {}) as Record<string, unknown>
  return handleToolCall(name, args)
})

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('google-workspace: MCP server started\n')
}

main().catch(err => {
  process.stderr.write(`google-workspace: fatal error: ${err}\n`)
  process.exit(1)
})
