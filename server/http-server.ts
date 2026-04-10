#!/usr/bin/env bun
/**
 * Google Workspace MCP HTTP Server for Claude Desktop.
 *
 * Runs the same MCP tools as server.ts but over Streamable HTTP transport
 * so Claude Desktop can connect to it as a custom connector.
 *
 * Usage: bun run serve
 * Then add http://localhost:5001/mcp as a custom connector in Claude Desktop.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readConfig, findAccount, listAccountSummaries, accountNames } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from './gmail-client.ts'
import type { Account, GoogleWorkspaceConfig } from '../shared/types.ts'

const PORT = 5001

// --- Shared tool logic (same as server.ts) ---

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2))
}

function noAccounts() {
  return text('No Google accounts configured. Open the management panel (bun run panel → localhost:5000) or run /google-workspace:setup to get started.')
}

function unknownAccount(config: GoogleWorkspaceConfig, name: string) {
  return text(`Unknown account "${name}". Available accounts: ${accountNames(config)}`)
}

async function withAccount(
  args: Record<string, unknown>,
  fn: (gmail: GmailClient, account: Account, config: GoogleWorkspaceConfig) => Promise<unknown>
) {
  const config = readConfig()
  if (config.accounts.length === 0) return noAccounts()

  const account = findAccount(config, args.account as string)
  if (!account) return unknownAccount(config, args.account as string)

  try {
    const client = await getAuthenticatedClient(config, account)
    const gmail = new GmailClient(client)
    const result = await fn(gmail, account, config)
    return json(result)
  } catch (err: any) {
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      return text(`Authentication failed for ${account.name} (${account.email}). Re-authenticate in the management panel at localhost:5000.`)
    }
    if (err.code === 429) {
      return text(`Rate limited by Google API for ${account.name}. Wait a moment and try again.`)
    }
    return text(`Error for ${account.name}: ${err.message}`)
  }
}

// --- Tool definitions ---

const ACCOUNT_PARAM = {
  account: { type: 'string' as const, description: 'Account name or email address' },
}

const tools = [
  {
    name: 'multi_gmail_list_accounts',
    description: 'List all connected Gmail accounts with name, email, and token status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'multi_gmail_get_profile',
    description: 'Get Gmail profile info (email, total messages, total threads).',
    inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] },
  },
  {
    name: 'multi_gmail_search',
    description: 'Search messages using Gmail query syntax. Returns message ID, thread ID, subject, from, date, snippet.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Gmail search query' },
        max_results: { type: 'number' as const, description: 'Maximum results (default 10)' },
      },
      required: ['account', 'query'],
    },
  },
  {
    name: 'multi_gmail_read_message',
    description: 'Read a full email message — headers, body, and attachment list.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, message_id: { type: 'string' as const, description: 'Gmail message ID' } },
      required: ['account', 'message_id'],
    },
  },
  {
    name: 'multi_gmail_read_thread',
    description: 'Read all messages in an email thread.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, thread_id: { type: 'string' as const, description: 'Gmail thread ID' } },
      required: ['account', 'thread_id'],
    },
  },
  {
    name: 'multi_gmail_create_draft',
    description: 'Create an email draft. Returns draft ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        to: { type: 'string' as const, description: 'Recipient email' },
        subject: { type: 'string' as const, description: 'Email subject' },
        body: { type: 'string' as const, description: 'Email body (plain text)' },
        cc: { type: 'string' as const, description: 'CC recipients' },
        bcc: { type: 'string' as const, description: 'BCC recipients' },
        in_reply_to: { type: 'string' as const, description: 'Message ID to reply to' },
      },
      required: ['account', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'multi_gmail_send',
    description: 'Send an email directly. Returns message ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        to: { type: 'string' as const, description: 'Recipient email' },
        subject: { type: 'string' as const, description: 'Email subject' },
        body: { type: 'string' as const, description: 'Email body (plain text)' },
        cc: { type: 'string' as const, description: 'CC recipients' },
        bcc: { type: 'string' as const, description: 'BCC recipients' },
        in_reply_to: { type: 'string' as const, description: 'Message ID to reply to' },
      },
      required: ['account', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'multi_gmail_list_drafts',
    description: 'List drafts with subject and snippet.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, max_results: { type: 'number' as const, description: 'Maximum results (default 10)' } },
      required: ['account'],
    },
  },
  {
    name: 'multi_gmail_list_labels',
    description: 'List all Gmail labels (system and user-created).',
    inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] },
  },
  {
    name: 'multi_gmail_modify_labels',
    description: 'Add or remove labels from a message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        message_id: { type: 'string' as const, description: 'Gmail message ID' },
        add_labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to add' },
        remove_labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to remove' },
      },
      required: ['account', 'message_id'],
    },
  },
  {
    name: 'multi_gmail_search_all',
    description: 'Search across ALL connected accounts. Returns results grouped by account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Gmail search query' },
        max_results: { type: 'number' as const, description: 'Max results per account (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'multi_gmail_unread_counts',
    description: 'Get unread inbox count for each connected account.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
]

// --- Per-session server factory ---

function createServer(): Server {
  const server = new Server(
    { name: 'google-workspace', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params
    const args = (req.params.arguments || {}) as Record<string, unknown>

    switch (name) {
      case 'multi_gmail_list_accounts': {
        const config = readConfig()
        if (config.accounts.length === 0) return noAccounts()
        return json(listAccountSummaries(config))
      }
      case 'multi_gmail_get_profile':
        return withAccount(args, async (gmail) => gmail.getProfile())
      case 'multi_gmail_search':
        return withAccount(args, async (gmail) => gmail.search(args.query as string, (args.max_results as number) || 10))
      case 'multi_gmail_read_message':
        return withAccount(args, async (gmail) => gmail.readMessage(args.message_id as string))
      case 'multi_gmail_read_thread':
        return withAccount(args, async (gmail) => gmail.readThread(args.thread_id as string))
      case 'multi_gmail_create_draft':
        return withAccount(args, async (gmail) => gmail.createDraft({
          to: args.to as string, subject: args.subject as string, body: args.body as string,
          cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, inReplyTo: args.in_reply_to as string | undefined,
        }))
      case 'multi_gmail_send':
        return withAccount(args, async (gmail) => gmail.send({
          to: args.to as string, subject: args.subject as string, body: args.body as string,
          cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, inReplyTo: args.in_reply_to as string | undefined,
        }))
      case 'multi_gmail_list_drafts':
        return withAccount(args, async (gmail) => gmail.listDrafts((args.max_results as number) || 10))
      case 'multi_gmail_list_labels':
        return withAccount(args, async (gmail) => gmail.listLabels())
      case 'multi_gmail_modify_labels':
        return withAccount(args, async (gmail) => gmail.modifyLabels(
          args.message_id as string, args.add_labels as string[] | undefined, args.remove_labels as string[] | undefined
        ))
      case 'multi_gmail_search_all': {
        const config = readConfig()
        if (config.accounts.length === 0) return noAccounts()
        const maxPer = (args.max_results as number) || 5
        const results: Record<string, unknown> = {}
        for (const account of config.accounts) {
          try {
            const client = await getAuthenticatedClient(config, account)
            const gmail = new GmailClient(client)
            results[`${account.name} (${account.email})`] = await gmail.search(args.query as string, maxPer)
          } catch (err: any) {
            results[`${account.name} (${account.email})`] = { error: err.message }
          }
        }
        return json(results)
      }
      case 'multi_gmail_unread_counts': {
        const config = readConfig()
        if (config.accounts.length === 0) return noAccounts()
        const counts: Record<string, unknown> = {}
        for (const account of config.accounts) {
          try {
            const client = await getAuthenticatedClient(config, account)
            const gmail = new GmailClient(client)
            counts[`${account.name} (${account.email})`] = await gmail.getUnreadCount()
          } catch (err: any) {
            counts[`${account.name} (${account.email})`] = { error: err.message }
          }
        }
        return json(counts)
      }
      default:
        return text(`Unknown tool: ${name}`)
    }
  })

  return server
}

// --- HTTP server with per-session transport ---

const sessions = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; server: Server }>()

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // CORS headers for Claude Desktop
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version',
      'Access-Control-Expose-Headers': 'mcp-session-id',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (url.pathname === '/mcp') {
      // Check for existing session
      const sessionId = req.headers.get('mcp-session-id')

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        const response = await session.transport.handleRequest(req)
        // Add CORS headers
        const newHeaders = new Headers(response.headers)
        for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)
        return new Response(response.body, { status: response.status, headers: newHeaders })
      }

      // New session
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server })
          console.log(`Session started: ${id}`)
        },
      })

      const server = createServer()

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
          console.log(`Session ended: ${transport.sessionId}`)
        }
      }

      await server.connect(transport)
      const response = await transport.handleRequest(req)
      const newHeaders = new Headers(response.headers)
      for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)
      return new Response(response.body, { status: response.status, headers: newHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  },
})

console.log(`Google Workspace MCP server running at http://localhost:${PORT}/mcp`)
console.log(`Add this URL as a custom connector in Claude Desktop.`)
