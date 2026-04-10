#!/usr/bin/env bun
/**
 * Multi-Gmail MCP HTTP Server for Claude Desktop.
 *
 * Runs the same MCP tools as server.ts but over Streamable HTTP transport
 * so Claude Desktop can connect to it as a custom connector.
 *
 * Usage: bun run serve
 * Then add http://localhost:3456/mcp as a custom connector in Claude Desktop.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readConfig, findAccount, listAccountSummaries, accountNames, findSlackWorkspace, listSlackWorkspaceSummaries, slackWorkspaceNames } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from './gmail-client.ts'
import { SlackClient } from './slack-client.ts'
import type { Account, SlackWorkspace, MultiGmailConfig } from '../shared/types.ts'

const PORT = 5001

// --- Shared tool logic (same as server.ts) ---

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2))
}

function noAccounts() {
  return text('No Gmail accounts configured. Open the management panel (bun run panel → localhost:5000) or run /multi-gmail:setup to get started.')
}

function unknownAccount(config: MultiGmailConfig, name: string) {
  return text(`Unknown account "${name}". Available accounts: ${accountNames(config)}`)
}

async function withAccount(
  args: Record<string, unknown>,
  fn: (gmail: GmailClient, account: Account, config: MultiGmailConfig) => Promise<unknown>
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
    // If we get a 401, try one more refresh before giving up
    if (err.code === 401 && !err.message?.includes('invalid_grant')) {
      try {
        const freshConfig = readConfig()
        const freshAccount = findAccount(freshConfig, args.account as string)
        if (freshAccount) {
          const retryClient = await getAuthenticatedClient(freshConfig, freshAccount)
          const gmail = new GmailClient(retryClient)
          const result = await fn(gmail, freshAccount, freshConfig)
          return json(result)
        }
      } catch (retryErr: any) {
        if (retryErr.message?.includes('invalid_grant')) {
          return text(`Refresh token expired for ${account.name} (${account.email}). Re-authenticate in the management panel at localhost:5000.`)
        }
      }
    }
    if (err.message?.includes('invalid_grant')) {
      return text(`Refresh token expired for ${account.name} (${account.email}). Re-authenticate in the management panel at localhost:5000.`)
    }
    if (err.code === 401) {
      return text(`Authentication failed for ${account.name} (${account.email}). Re-authenticate in the management panel at localhost:5000.`)
    }
    if (err.code === 429) {
      return text(`Rate limited by Gmail API for ${account.name}. Wait a moment and try again.`)
    }
    return text(`Error for ${account.name}: ${err.message}`)
  }
}

// --- Slack tool handler helpers ---

function noSlackWorkspaces() {
  return text('No Slack workspaces configured. Open the management panel (bun run panel → localhost:5000) to add a Slack workspace.')
}

function unknownSlackWorkspace(config: MultiGmailConfig, name: string) {
  return text(`Unknown workspace "${name}". Available workspaces: ${slackWorkspaceNames(config)}`)
}

async function withSlackWorkspace(
  args: Record<string, unknown>,
  fn: (slack: SlackClient, workspace: SlackWorkspace, config: MultiGmailConfig) => Promise<unknown>
) {
  const config = readConfig()
  if (config.slack_workspaces.length === 0) return noSlackWorkspaces()

  const workspace = findSlackWorkspace(config, args.workspace as string)
  if (!workspace) return unknownSlackWorkspace(config, args.workspace as string)

  try {
    const slack = new SlackClient(workspace.bot_token, workspace.user_token)
    const result = await fn(slack, workspace, config)
    return json(result)
  } catch (err: any) {
    if (err.code === 'token_revoked' || err.data?.error === 'token_revoked' || err.data?.error === 'invalid_auth') {
      return text(`Authentication failed for workspace ${workspace.name} (${workspace.team_name}). Re-authorize in the management panel at localhost:5000.`)
    }
    if (err.data?.error === 'ratelimited') {
      return text(`Rate limited by Slack API for ${workspace.name}. Wait a moment and try again.`)
    }
    return text(`Error for ${workspace.name}: ${err.message}`)
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

// --- Slack tool definitions ---

const WORKSPACE_PARAM = {
  workspace: { type: 'string' as const, description: 'Workspace name or team name' },
}

const slackTools = [
  {
    name: 'multi_slack_list_workspaces',
    description: 'List all connected Slack workspaces with name, team, and token status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'multi_slack_list_channels',
    description: 'List channels in a Slack workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        types: { type: 'array' as const, items: { type: 'string' as const }, description: 'Channel types (default: ["public_channel", "private_channel"])' },
        limit: { type: 'number' as const, description: 'Maximum channels (default 200)' },
      },
      required: ['workspace'],
    },
  },
  {
    name: 'multi_slack_read_channel_history',
    description: 'Read recent messages from a Slack channel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        channel_id: { type: 'string' as const, description: 'Slack channel ID' },
        limit: { type: 'number' as const, description: 'Maximum messages (default 20)' },
      },
      required: ['workspace', 'channel_id'],
    },
  },
  {
    name: 'multi_slack_post_message',
    description: 'Post a message to a Slack channel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        channel_id: { type: 'string' as const, description: 'Slack channel ID' },
        text: { type: 'string' as const, description: 'Message text' },
      },
      required: ['workspace', 'channel_id', 'text'],
    },
  },
  {
    name: 'multi_slack_reply_to_thread',
    description: 'Reply to a message thread in Slack.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        channel_id: { type: 'string' as const, description: 'Slack channel ID' },
        thread_ts: { type: 'string' as const, description: 'Parent message timestamp' },
        text: { type: 'string' as const, description: 'Reply text' },
      },
      required: ['workspace', 'channel_id', 'thread_ts', 'text'],
    },
  },
  {
    name: 'multi_slack_search_messages',
    description: 'Search messages in a Slack workspace. Requires user token.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        query: { type: 'string' as const, description: 'Search query' },
        count: { type: 'number' as const, description: 'Maximum results (default 20)' },
      },
      required: ['workspace', 'query'],
    },
  },
  {
    name: 'multi_slack_list_users',
    description: 'List users in a Slack workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        limit: { type: 'number' as const, description: 'Maximum users (default 200)' },
      },
      required: ['workspace'],
    },
  },
  {
    name: 'multi_slack_get_user_info',
    description: 'Get detailed info about a Slack user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        user_id: { type: 'string' as const, description: 'Slack user ID' },
      },
      required: ['workspace', 'user_id'],
    },
  },
  {
    name: 'multi_slack_add_reaction',
    description: 'Add an emoji reaction to a Slack message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...WORKSPACE_PARAM,
        channel_id: { type: 'string' as const, description: 'Slack channel ID' },
        timestamp: { type: 'string' as const, description: 'Message timestamp' },
        emoji: { type: 'string' as const, description: 'Emoji name without colons' },
      },
      required: ['workspace', 'channel_id', 'timestamp', 'emoji'],
    },
  },
  {
    name: 'multi_slack_search_all',
    description: 'Search messages across ALL connected Slack workspaces.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
        count: { type: 'number' as const, description: 'Max results per workspace (default 5)' },
      },
      required: ['query'],
    },
  },
]

// --- Per-session server factory ---

function createServer(): Server {
  const server = new Server(
    { name: 'multi-gmail', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools, ...slackTools] }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params
    const args = (req.params.arguments || {}) as Record<string, unknown>

    switch (name) {
      // --- Gmail tools ---
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

      // --- Slack tools ---
      case 'multi_slack_list_workspaces': {
        const config = readConfig()
        if (config.slack_workspaces.length === 0) return noSlackWorkspaces()
        return json(listSlackWorkspaceSummaries(config))
      }
      case 'multi_slack_list_channels':
        return withSlackWorkspace(args, async (slack) =>
          slack.listChannels(args.types as string[] | undefined, (args.limit as number) || 200))
      case 'multi_slack_read_channel_history':
        return withSlackWorkspace(args, async (slack) =>
          slack.getChannelHistory(args.channel_id as string, (args.limit as number) || 20))
      case 'multi_slack_post_message':
        return withSlackWorkspace(args, async (slack) =>
          slack.postMessage(args.channel_id as string, args.text as string))
      case 'multi_slack_reply_to_thread':
        return withSlackWorkspace(args, async (slack) =>
          slack.replyToThread(args.channel_id as string, args.thread_ts as string, args.text as string))
      case 'multi_slack_search_messages':
        return withSlackWorkspace(args, async (slack) =>
          slack.searchMessages(args.query as string, (args.count as number) || 20))
      case 'multi_slack_list_users':
        return withSlackWorkspace(args, async (slack) =>
          slack.listUsers((args.limit as number) || 200))
      case 'multi_slack_get_user_info':
        return withSlackWorkspace(args, async (slack) =>
          slack.getUserInfo(args.user_id as string))
      case 'multi_slack_add_reaction':
        return withSlackWorkspace(args, async (slack) =>
          slack.addReaction(args.channel_id as string, args.timestamp as string, args.emoji as string))
      case 'multi_slack_search_all': {
        const config = readConfig()
        if (config.slack_workspaces.length === 0) return noSlackWorkspaces()
        const countPer = (args.count as number) || 5
        const results: Record<string, unknown> = {}
        for (const workspace of config.slack_workspaces) {
          try {
            const slack = new SlackClient(workspace.bot_token, workspace.user_token)
            results[`${workspace.name} (${workspace.team_name})`] = await slack.searchMessages(args.query as string, countPer)
          } catch (err: any) {
            results[`${workspace.name} (${workspace.team_name})`] = { error: err.message }
          }
        }
        return json(results)
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

console.log(`Multi-Gmail MCP server running at http://localhost:${PORT}/mcp`)
console.log(`Add this URL as a custom connector in Claude Desktop.`)
