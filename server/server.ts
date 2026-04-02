#!/usr/bin/env bun
/**
 * Multi-Gmail MCP server for Claude Code.
 *
 * Manages multiple Gmail accounts with custom names.
 * State lives in ~/.claude/channels/multi-gmail/config.json.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readConfig, findAccount, listAccountSummaries, accountNames } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from './gmail-client.ts'
import type { Account, MultiGmailConfig } from '../shared/types.ts'

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
    instructions: `Multi-Gmail manages multiple Gmail accounts. Every email tool requires an account parameter — the custom name or email.

When the user doesn't specify which account:
- If only one account exists, use it without asking.
- If multiple exist, ALWAYS ask the user which account before proceeding.

Label results clearly with the account name and email. For cross-account tools (search_all, unread_counts), group results by account.

Account management (add, remove, rename) happens in the management panel at localhost:5000.`,
  }
)

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
    inputSchema: {
      type: 'object' as const,
      properties: ACCOUNT_PARAM,
      required: ['account'],
    },
  },
  {
    name: 'multi_gmail_search',
    description: 'Search messages using Gmail query syntax. Returns message ID, thread ID, subject, from, date, snippet.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Gmail search query (e.g., "from:alice subject:meeting is:unread")' },
        max_results: { type: 'number' as const, description: 'Maximum results to return (default 10)' },
      },
      required: ['account', 'query'],
    },
  },
  {
    name: 'multi_gmail_read_message',
    description: 'Read a full email message — headers, body, and attachment list.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        message_id: { type: 'string' as const, description: 'Gmail message ID' },
      },
      required: ['account', 'message_id'],
    },
  },
  {
    name: 'multi_gmail_read_thread',
    description: 'Read all messages in an email thread.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        thread_id: { type: 'string' as const, description: 'Gmail thread ID' },
      },
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
        to: { type: 'string' as const, description: 'Recipient email address' },
        subject: { type: 'string' as const, description: 'Email subject' },
        body: { type: 'string' as const, description: 'Email body (plain text)' },
        cc: { type: 'string' as const, description: 'CC recipients (optional)' },
        bcc: { type: 'string' as const, description: 'BCC recipients (optional)' },
        in_reply_to: { type: 'string' as const, description: 'Message ID to reply to (optional)' },
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
        to: { type: 'string' as const, description: 'Recipient email address' },
        subject: { type: 'string' as const, description: 'Email subject' },
        body: { type: 'string' as const, description: 'Email body (plain text)' },
        cc: { type: 'string' as const, description: 'CC recipients (optional)' },
        bcc: { type: 'string' as const, description: 'BCC recipients (optional)' },
        in_reply_to: { type: 'string' as const, description: 'Message ID to reply to (optional)' },
      },
      required: ['account', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'multi_gmail_list_drafts',
    description: 'List drafts with subject and snippet.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        max_results: { type: 'number' as const, description: 'Maximum results (default 10)' },
      },
      required: ['account'],
    },
  },
  {
    name: 'multi_gmail_list_labels',
    description: 'List all Gmail labels (system and user-created).',
    inputSchema: {
      type: 'object' as const,
      properties: ACCOUNT_PARAM,
      required: ['account'],
    },
  },
  {
    name: 'multi_gmail_modify_labels',
    description: 'Add or remove labels from a message (archive, star, categorize, etc).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        message_id: { type: 'string' as const, description: 'Gmail message ID' },
        add_labels: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Label IDs to add',
        },
        remove_labels: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Label IDs to remove',
        },
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

// --- Tool handler helpers ---

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
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      return text(`Authentication failed for ${account.name} (${account.email}). Re-authenticate in the management panel at localhost:5000.`)
    }
    if (err.code === 429) {
      return text(`Rate limited by Gmail API for ${account.name}. Wait a moment and try again.`)
    }
    return text(`Error for ${account.name}: ${err.message}`)
  }
}

// --- Tool call handler ---

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
      return withAccount(args, async (gmail) =>
        gmail.search(args.query as string, (args.max_results as number) || 10)
      )

    case 'multi_gmail_read_message':
      return withAccount(args, async (gmail) =>
        gmail.readMessage(args.message_id as string)
      )

    case 'multi_gmail_read_thread':
      return withAccount(args, async (gmail) =>
        gmail.readThread(args.thread_id as string)
      )

    case 'multi_gmail_create_draft':
      return withAccount(args, async (gmail) =>
        gmail.createDraft({
          to: args.to as string,
          subject: args.subject as string,
          body: args.body as string,
          cc: args.cc as string | undefined,
          bcc: args.bcc as string | undefined,
          inReplyTo: args.in_reply_to as string | undefined,
        })
      )

    case 'multi_gmail_send':
      return withAccount(args, async (gmail) =>
        gmail.send({
          to: args.to as string,
          subject: args.subject as string,
          body: args.body as string,
          cc: args.cc as string | undefined,
          bcc: args.bcc as string | undefined,
          inReplyTo: args.in_reply_to as string | undefined,
        })
      )

    case 'multi_gmail_list_drafts':
      return withAccount(args, async (gmail) =>
        gmail.listDrafts((args.max_results as number) || 10)
      )

    case 'multi_gmail_list_labels':
      return withAccount(args, async (gmail) => gmail.listLabels())

    case 'multi_gmail_modify_labels':
      return withAccount(args, async (gmail) =>
        gmail.modifyLabels(
          args.message_id as string,
          args.add_labels as string[] | undefined,
          args.remove_labels as string[] | undefined
        )
      )

    case 'multi_gmail_search_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()

      const maxPer = (args.max_results as number) || 5
      const results: Record<string, unknown> = {}

      for (const account of config.accounts) {
        try {
          const client = await getAuthenticatedClient(config, account)
          const gmail = new GmailClient(client)
          results[`${account.name} (${account.email})`] = await gmail.search(
            args.query as string,
            maxPer
          )
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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('multi-gmail: MCP server started\n')
}

main().catch(err => {
  process.stderr.write(`multi-gmail: fatal error: ${err}\n`)
  process.exit(1)
})
