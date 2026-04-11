/**
 * Shared tool definitions and handler for the MCP server.
 * Imported by both server.ts (stdio) and http-server.ts (HTTP).
 */

import { readConfig, findAccount, listAccountSummaries, accountNames, findSlackWorkspace, listSlackWorkspaceSummaries, slackWorkspaceNames } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from './gmail-client.ts'
import { CalendarClient } from './calendar-client.ts'
import { DriveClient } from './drive-client.ts'
import { DocsClient } from './docs-client.ts'
import { SheetsClient } from './sheets-client.ts'
import { SlidesClient } from './slides-client.ts'
import { SlackClient } from './slack-client.ts'
import type { Account, SlackWorkspace, MultiGmailConfig } from '../shared/types.ts'
import type { OAuth2Client } from 'google-auth-library'

// --- Response helpers ---

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2))
}

function noAccounts() {
  return text('No Google accounts configured. Open the management panel (bun run panel → localhost:5000) or run /multi-gmail:setup to get started.')
}

function unknownAccount(config: MultiGmailConfig, name: string) {
  return text(`Unknown account "${name}". Available accounts: ${accountNames(config)}`)
}

async function withGoogleAuth(
  args: Record<string, unknown>,
  fn: (auth: OAuth2Client, account: Account, config: MultiGmailConfig) => Promise<unknown>
) {
  const config = readConfig()
  if (config.accounts.length === 0) return noAccounts()

  const account = findAccount(config, args.account as string)
  if (!account) return unknownAccount(config, args.account as string)

  try {
    const auth = await getAuthenticatedClient(config, account)
    const result = await fn(auth, account, config)
    return json(result)
  } catch (err: any) {
    if (err.code === 401 && !err.message?.includes('invalid_grant')) {
      try {
        const freshConfig = readConfig()
        const freshAccount = findAccount(freshConfig, args.account as string)
        if (freshAccount) {
          const retryAuth = await getAuthenticatedClient(freshConfig, freshAccount)
          const result = await fn(retryAuth, freshAccount, freshConfig)
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
      return text(`Rate limited by Google API for ${account.name}. Wait a moment and try again.`)
    }
    return text(`Error for ${account.name}: ${err.message}`)
  }
}

// --- Slack helpers ---

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

const WORKSPACE_PARAM = {
  workspace: { type: 'string' as const, description: 'Workspace name or team name' },
}

const gmailTools = [
  { name: 'multi_gmail_list_accounts', description: 'List all connected Google accounts with name, email, and token status.', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'multi_gmail_get_profile', description: 'Get Gmail profile info (email, total messages, total threads).', inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] } },
  { name: 'multi_gmail_search', description: 'Search messages using Gmail query syntax.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, query: { type: 'string' as const, description: 'Gmail search query' }, max_results: { type: 'number' as const, description: 'Maximum results (default 10)' } }, required: ['account', 'query'] } },
  { name: 'multi_gmail_read_message', description: 'Read a full email message — headers, body, and attachment list.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, message_id: { type: 'string' as const, description: 'Gmail message ID' } }, required: ['account', 'message_id'] } },
  { name: 'multi_gmail_read_thread', description: 'Read all messages in an email thread.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, thread_id: { type: 'string' as const, description: 'Gmail thread ID' } }, required: ['account', 'thread_id'] } },
  { name: 'multi_gmail_create_draft', description: 'Create an email draft. Returns draft ID.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, to: { type: 'string' as const, description: 'Recipient email' }, subject: { type: 'string' as const, description: 'Email subject' }, body: { type: 'string' as const, description: 'Email body (plain text)' }, cc: { type: 'string' as const, description: 'CC recipients' }, bcc: { type: 'string' as const, description: 'BCC recipients' }, in_reply_to: { type: 'string' as const, description: 'Message ID to reply to' } }, required: ['account', 'to', 'subject', 'body'] } },
  { name: 'multi_gmail_send', description: 'Send an email directly. Returns message ID.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, to: { type: 'string' as const, description: 'Recipient email' }, subject: { type: 'string' as const, description: 'Email subject' }, body: { type: 'string' as const, description: 'Email body (plain text)' }, cc: { type: 'string' as const, description: 'CC recipients' }, bcc: { type: 'string' as const, description: 'BCC recipients' }, in_reply_to: { type: 'string' as const, description: 'Message ID to reply to' } }, required: ['account', 'to', 'subject', 'body'] } },
  { name: 'multi_gmail_list_drafts', description: 'List drafts with subject and snippet.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, max_results: { type: 'number' as const, description: 'Maximum results (default 10)' } }, required: ['account'] } },
  { name: 'multi_gmail_list_labels', description: 'List all Gmail labels (system and user-created).', inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] } },
  { name: 'multi_gmail_modify_labels', description: 'Add or remove labels from a message.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, message_id: { type: 'string' as const, description: 'Gmail message ID' }, add_labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to add' }, remove_labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to remove' } }, required: ['account', 'message_id'] } },
  { name: 'multi_gmail_search_all', description: 'Search across ALL connected accounts. Returns results grouped by account.', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' as const, description: 'Gmail search query' }, max_results: { type: 'number' as const, description: 'Max results per account (default 5)' } }, required: ['query'] } },
  { name: 'multi_gmail_unread_counts', description: 'Get unread inbox count for each connected account.', inputSchema: { type: 'object' as const, properties: {} } },
]

const calendarTools = [
  { name: 'gw_calendar_list_calendars', description: 'List all calendars for the account.', inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] } },
  { name: 'gw_calendar_list_events', description: 'List upcoming events. Defaults to primary calendar and next 7 days.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' }, time_min: { type: 'string' as const, description: 'Start of time range (ISO 8601). Defaults to now.' }, time_max: { type: 'string' as const, description: 'End of time range (ISO 8601). Defaults to 7 days from now.' }, max_results: { type: 'number' as const, description: 'Maximum events (default 20)' } }, required: ['account'] } },
  { name: 'gw_calendar_get_event', description: 'Get full details of a calendar event.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' }, event_id: { type: 'string' as const, description: 'Event ID' } }, required: ['account', 'event_id'] } },
  { name: 'gw_calendar_create_event', description: 'Create a new calendar event.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' }, summary: { type: 'string' as const, description: 'Event title' }, start: { type: 'string' as const, description: 'Start time (ISO 8601)' }, end: { type: 'string' as const, description: 'End time (ISO 8601)' }, description: { type: 'string' as const, description: 'Event description' }, location: { type: 'string' as const, description: 'Event location' }, attendees: { type: 'array' as const, items: { type: 'string' as const }, description: 'Attendee email addresses' } }, required: ['account', 'summary', 'start', 'end'] } },
  { name: 'gw_calendar_update_event', description: 'Update fields on an existing calendar event.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' }, event_id: { type: 'string' as const, description: 'Event ID' }, summary: { type: 'string' as const, description: 'New title' }, start: { type: 'string' as const, description: 'New start time (ISO 8601)' }, end: { type: 'string' as const, description: 'New end time (ISO 8601)' }, description: { type: 'string' as const, description: 'New description' }, location: { type: 'string' as const, description: 'New location' }, attendees: { type: 'array' as const, items: { type: 'string' as const }, description: 'New attendee list' } }, required: ['account', 'event_id'] } },
  { name: 'gw_calendar_delete_event', description: 'Delete a calendar event.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' }, event_id: { type: 'string' as const, description: 'Event ID' } }, required: ['account', 'event_id'] } },
  { name: 'gw_calendar_list_events_all', description: 'List upcoming events across ALL connected accounts.', inputSchema: { type: 'object' as const, properties: { time_min: { type: 'string' as const, description: 'Start (ISO 8601). Defaults to now.' }, time_max: { type: 'string' as const, description: 'End (ISO 8601). Defaults to 7 days from now.' }, max_results: { type: 'number' as const, description: 'Max events per account (default 10)' } } } },
]

const driveTools = [
  { name: 'gw_drive_list', description: 'List files in a Drive folder. Defaults to root.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, folder_id: { type: 'string' as const, description: 'Folder ID (default: "root")' }, max_results: { type: 'number' as const, description: 'Max files (default 20)' } }, required: ['account'] } },
  { name: 'gw_drive_search', description: 'Search for files in Drive by name.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, query: { type: 'string' as const, description: 'Search query' }, mime_type: { type: 'string' as const, description: 'Filter by MIME type' }, max_results: { type: 'number' as const, description: 'Max results (default 20)' } }, required: ['account', 'query'] } },
  { name: 'gw_drive_get', description: 'Get file metadata.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, file_id: { type: 'string' as const, description: 'Drive file ID' } }, required: ['account', 'file_id'] } },
  { name: 'gw_drive_create_folder', description: 'Create a new folder in Drive.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, name: { type: 'string' as const, description: 'Folder name' }, parent_id: { type: 'string' as const, description: 'Parent folder ID (default: root)' } }, required: ['account', 'name'] } },
  { name: 'gw_drive_share', description: 'Share a file or folder.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, file_id: { type: 'string' as const, description: 'File or folder ID' }, email: { type: 'string' as const, description: 'Email to share with (omit for public)' }, role: { type: 'string' as const, description: 'Role: "reader", "writer", "commenter" (default: "reader")' } }, required: ['account', 'file_id'] } },
  { name: 'gw_drive_download', description: 'Download or export file content (text-based only).', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, file_id: { type: 'string' as const, description: 'Drive file ID' } }, required: ['account', 'file_id'] } },
  { name: 'gw_drive_search_all', description: 'Search files across ALL accounts.', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' as const, description: 'Search query' }, max_results: { type: 'number' as const, description: 'Max per account (default 5)' } }, required: ['query'] } },
]

const docsTools = [
  { name: 'gw_docs_get', description: "Get a Google Doc's content as plain text.", inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, document_id: { type: 'string' as const, description: 'Document ID' } }, required: ['account', 'document_id'] } },
  { name: 'gw_docs_create', description: 'Create a new Google Doc.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Document title' } }, required: ['account', 'title'] } },
  { name: 'gw_docs_append', description: 'Append text to a Google Doc.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, document_id: { type: 'string' as const, description: 'Document ID' }, text: { type: 'string' as const, description: 'Text to append' } }, required: ['account', 'document_id', 'text'] } },
  { name: 'gw_docs_search', description: 'Search for Google Docs by name.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, query: { type: 'string' as const, description: 'Search query' }, max_results: { type: 'number' as const, description: 'Max results (default 20)' } }, required: ['account', 'query'] } },
]

const sheetsTools = [
  { name: 'gw_sheets_get', description: 'Get spreadsheet metadata.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, spreadsheet_id: { type: 'string' as const, description: 'Spreadsheet ID' } }, required: ['account', 'spreadsheet_id'] } },
  { name: 'gw_sheets_read', description: 'Read cell data from a range.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, spreadsheet_id: { type: 'string' as const, description: 'Spreadsheet ID' }, range: { type: 'string' as const, description: 'Range in A1 notation (e.g., "Sheet1!A1:D10")' } }, required: ['account', 'spreadsheet_id', 'range'] } },
  { name: 'gw_sheets_write', description: 'Write data to a range.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, spreadsheet_id: { type: 'string' as const, description: 'Spreadsheet ID' }, range: { type: 'string' as const, description: 'Range in A1 notation' }, values: { type: 'array' as const, items: { type: 'array' as const, items: { type: 'string' as const } }, description: 'Array of rows' } }, required: ['account', 'spreadsheet_id', 'range', 'values'] } },
  { name: 'gw_sheets_create', description: 'Create a new spreadsheet.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Title' } }, required: ['account', 'title'] } },
  { name: 'gw_sheets_search', description: 'Search for spreadsheets by name.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, query: { type: 'string' as const, description: 'Search query' }, max_results: { type: 'number' as const, description: 'Max results (default 20)' } }, required: ['account', 'query'] } },
]

const slidesTools = [
  { name: 'gw_slides_get', description: 'Get presentation metadata and content.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, presentation_id: { type: 'string' as const, description: 'Presentation ID' } }, required: ['account', 'presentation_id'] } },
  { name: 'gw_slides_create', description: 'Create a new presentation.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Title' } }, required: ['account', 'title'] } },
  { name: 'gw_slides_add_slide', description: 'Add a new slide.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, presentation_id: { type: 'string' as const, description: 'Presentation ID' }, layout: { type: 'string' as const, description: 'Layout: "BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_ONLY", "SECTION_HEADER"' }, insertion_index: { type: 'number' as const, description: 'Position (0-indexed)' } }, required: ['account', 'presentation_id'] } },
  { name: 'gw_slides_search', description: 'Search for presentations by name.', inputSchema: { type: 'object' as const, properties: { ...ACCOUNT_PARAM, query: { type: 'string' as const, description: 'Search query' }, max_results: { type: 'number' as const, description: 'Max results (default 20)' } }, required: ['account', 'query'] } },
]

const slackTools = [
  { name: 'multi_slack_list_workspaces', description: 'List all connected Slack workspaces.', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'multi_slack_list_channels', description: 'List channels in a Slack workspace.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, types: { type: 'array' as const, items: { type: 'string' as const }, description: 'Channel types (default: ["public_channel", "private_channel"])' }, limit: { type: 'number' as const, description: 'Max channels (default 200)' } }, required: ['workspace'] } },
  { name: 'multi_slack_read_channel_history', description: 'Read recent messages from a channel.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, channel_id: { type: 'string' as const, description: 'Channel ID' }, limit: { type: 'number' as const, description: 'Max messages (default 20)' } }, required: ['workspace', 'channel_id'] } },
  { name: 'multi_slack_post_message', description: 'Post a message to a channel.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, channel_id: { type: 'string' as const, description: 'Channel ID' }, text: { type: 'string' as const, description: 'Message text' } }, required: ['workspace', 'channel_id', 'text'] } },
  { name: 'multi_slack_reply_to_thread', description: 'Reply in a message thread.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, channel_id: { type: 'string' as const, description: 'Channel ID' }, thread_ts: { type: 'string' as const, description: 'Parent message timestamp' }, text: { type: 'string' as const, description: 'Reply text' } }, required: ['workspace', 'channel_id', 'thread_ts', 'text'] } },
  { name: 'multi_slack_search_messages', description: 'Search messages in a workspace (requires user token).', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, query: { type: 'string' as const, description: 'Search query' }, count: { type: 'number' as const, description: 'Max results (default 20)' } }, required: ['workspace', 'query'] } },
  { name: 'multi_slack_list_users', description: 'List users in a workspace.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, limit: { type: 'number' as const, description: 'Max users (default 200)' } }, required: ['workspace'] } },
  { name: 'multi_slack_get_user_info', description: 'Get detailed info about a user.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, user_id: { type: 'string' as const, description: 'User ID' } }, required: ['workspace', 'user_id'] } },
  { name: 'multi_slack_add_reaction', description: 'Add an emoji reaction to a message.', inputSchema: { type: 'object' as const, properties: { ...WORKSPACE_PARAM, channel_id: { type: 'string' as const, description: 'Channel ID' }, timestamp: { type: 'string' as const, description: 'Message timestamp' }, emoji: { type: 'string' as const, description: 'Emoji name (e.g., "thumbsup")' } }, required: ['workspace', 'channel_id', 'timestamp', 'emoji'] } },
  { name: 'multi_slack_search_all', description: 'Search across ALL workspaces.', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' as const, description: 'Search query' }, count: { type: 'number' as const, description: 'Max per workspace (default 5)' } }, required: ['query'] } },
]

export const tools = [...gmailTools, ...calendarTools, ...driveTools, ...docsTools, ...sheetsTools, ...slidesTools, ...slackTools]

// --- Tool call handler ---

export async function handleToolCall(toolName: string, args: Record<string, unknown>) {
  switch (toolName) {
    // === Gmail ===
    case 'multi_gmail_list_accounts': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      return json(listAccountSummaries(config))
    }
    case 'multi_gmail_get_profile':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).getProfile())
    case 'multi_gmail_search':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).search(args.query as string, (args.max_results as number) || 10))
    case 'multi_gmail_read_message':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).readMessage(args.message_id as string))
    case 'multi_gmail_read_thread':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).readThread(args.thread_id as string))
    case 'multi_gmail_create_draft':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).createDraft({
        to: args.to as string, subject: args.subject as string, body: args.body as string,
        cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, inReplyTo: args.in_reply_to as string | undefined,
      }))
    case 'multi_gmail_send':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).send({
        to: args.to as string, subject: args.subject as string, body: args.body as string,
        cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, inReplyTo: args.in_reply_to as string | undefined,
      }))
    case 'multi_gmail_list_drafts':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).listDrafts((args.max_results as number) || 10))
    case 'multi_gmail_list_labels':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).listLabels())
    case 'multi_gmail_modify_labels':
      return withGoogleAuth(args, async (auth) => new GmailClient(auth).modifyLabels(
        args.message_id as string, args.add_labels as string[] | undefined, args.remove_labels as string[] | undefined))
    case 'multi_gmail_search_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const maxPer = (args.max_results as number) || 5
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new GmailClient(auth).search(args.query as string, maxPer)
        } catch (err: any) { results[`${account.name} (${account.email})`] = { error: err.message } }
      }
      return json(results)
    }
    case 'multi_gmail_unread_counts': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const counts: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          counts[`${account.name} (${account.email})`] = await new GmailClient(auth).getUnreadCount()
        } catch (err: any) { counts[`${account.name} (${account.email})`] = { error: err.message } }
      }
      return json(counts)
    }

    // === Calendar ===
    case 'gw_calendar_list_calendars':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).listCalendars())
    case 'gw_calendar_list_events':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).listEvents(
        args.calendar_id as string | undefined, args.time_min as string | undefined,
        args.time_max as string | undefined, (args.max_results as number) || 20))
    case 'gw_calendar_get_event':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).getEvent(args.event_id as string, args.calendar_id as string | undefined))
    case 'gw_calendar_create_event':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).createEvent({
        calendarId: args.calendar_id as string | undefined, summary: args.summary as string,
        start: args.start as string, end: args.end as string,
        description: args.description as string | undefined, location: args.location as string | undefined,
        attendees: args.attendees as string[] | undefined,
      }))
    case 'gw_calendar_update_event':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).updateEvent({
        calendarId: args.calendar_id as string | undefined, eventId: args.event_id as string,
        summary: args.summary as string | undefined, start: args.start as string | undefined,
        end: args.end as string | undefined, description: args.description as string | undefined,
        location: args.location as string | undefined, attendees: args.attendees as string[] | undefined,
      }))
    case 'gw_calendar_delete_event':
      return withGoogleAuth(args, async (auth) => new CalendarClient(auth).deleteEvent(args.event_id as string, args.calendar_id as string | undefined))
    case 'gw_calendar_list_events_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new CalendarClient(auth).listEvents(
            undefined, args.time_min as string | undefined, args.time_max as string | undefined, (args.max_results as number) || 10)
        } catch (err: any) { results[`${account.name} (${account.email})`] = { error: err.message } }
      }
      return json(results)
    }

    // === Drive ===
    case 'gw_drive_list':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).listFiles(args.folder_id as string | undefined, (args.max_results as number) || 20))
    case 'gw_drive_search':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).search(args.query as string, args.mime_type as string | undefined, (args.max_results as number) || 20))
    case 'gw_drive_get':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).getFile(args.file_id as string))
    case 'gw_drive_create_folder':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).createFolder(args.name as string, args.parent_id as string | undefined))
    case 'gw_drive_share':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).share(args.file_id as string, args.email as string | undefined, (args.role as string) || 'reader'))
    case 'gw_drive_download':
      return withGoogleAuth(args, async (auth) => new DriveClient(auth).download(args.file_id as string))
    case 'gw_drive_search_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const maxPer = (args.max_results as number) || 5
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new DriveClient(auth).search(args.query as string, undefined, maxPer)
        } catch (err: any) { results[`${account.name} (${account.email})`] = { error: err.message } }
      }
      return json(results)
    }

    // === Docs ===
    case 'gw_docs_get':
      return withGoogleAuth(args, async (auth) => new DocsClient(auth).getDocument(args.document_id as string))
    case 'gw_docs_create':
      return withGoogleAuth(args, async (auth) => new DocsClient(auth).createDocument(args.title as string))
    case 'gw_docs_append':
      return withGoogleAuth(args, async (auth) => new DocsClient(auth).appendText(args.document_id as string, args.text as string))
    case 'gw_docs_search':
      return withGoogleAuth(args, async (auth) => new DocsClient(auth).search(args.query as string, (args.max_results as number) || 20))

    // === Sheets ===
    case 'gw_sheets_get':
      return withGoogleAuth(args, async (auth) => new SheetsClient(auth).getSpreadsheet(args.spreadsheet_id as string))
    case 'gw_sheets_read':
      return withGoogleAuth(args, async (auth) => new SheetsClient(auth).readRange(args.spreadsheet_id as string, args.range as string))
    case 'gw_sheets_write':
      return withGoogleAuth(args, async (auth) => new SheetsClient(auth).writeRange(args.spreadsheet_id as string, args.range as string, args.values as string[][]))
    case 'gw_sheets_create':
      return withGoogleAuth(args, async (auth) => new SheetsClient(auth).createSpreadsheet(args.title as string))
    case 'gw_sheets_search':
      return withGoogleAuth(args, async (auth) => new SheetsClient(auth).search(args.query as string, (args.max_results as number) || 20))

    // === Slides ===
    case 'gw_slides_get':
      return withGoogleAuth(args, async (auth) => new SlidesClient(auth).getPresentation(args.presentation_id as string))
    case 'gw_slides_create':
      return withGoogleAuth(args, async (auth) => new SlidesClient(auth).createPresentation(args.title as string))
    case 'gw_slides_add_slide':
      return withGoogleAuth(args, async (auth) => new SlidesClient(auth).addSlide(args.presentation_id as string, args.layout as string | undefined, args.insertion_index as number | undefined))
    case 'gw_slides_search':
      return withGoogleAuth(args, async (auth) => new SlidesClient(auth).search(args.query as string, (args.max_results as number) || 20))

    // === Slack ===
    case 'multi_slack_list_workspaces': {
      const config = readConfig()
      if (config.slack_workspaces.length === 0) return noSlackWorkspaces()
      return json(listSlackWorkspaceSummaries(config))
    }
    case 'multi_slack_list_channels':
      return withSlackWorkspace(args, async (slack) => slack.listChannels(args.types as string[] | undefined, (args.limit as number) || 200))
    case 'multi_slack_read_channel_history':
      return withSlackWorkspace(args, async (slack) => slack.getChannelHistory(args.channel_id as string, (args.limit as number) || 20))
    case 'multi_slack_post_message':
      return withSlackWorkspace(args, async (slack) => slack.postMessage(args.channel_id as string, args.text as string))
    case 'multi_slack_reply_to_thread':
      return withSlackWorkspace(args, async (slack) => slack.replyToThread(args.channel_id as string, args.thread_ts as string, args.text as string))
    case 'multi_slack_search_messages':
      return withSlackWorkspace(args, async (slack) => slack.searchMessages(args.query as string, (args.count as number) || 20))
    case 'multi_slack_list_users':
      return withSlackWorkspace(args, async (slack) => slack.listUsers((args.limit as number) || 200))
    case 'multi_slack_get_user_info':
      return withSlackWorkspace(args, async (slack) => slack.getUserInfo(args.user_id as string))
    case 'multi_slack_add_reaction':
      return withSlackWorkspace(args, async (slack) => slack.addReaction(args.channel_id as string, args.timestamp as string, args.emoji as string))
    case 'multi_slack_search_all': {
      const config = readConfig()
      if (config.slack_workspaces.length === 0) return noSlackWorkspaces()
      const countPer = (args.count as number) || 5
      const results: Record<string, unknown> = {}
      for (const workspace of config.slack_workspaces) {
        try {
          const slack = new SlackClient(workspace.bot_token, workspace.user_token)
          results[`${workspace.name} (${workspace.team_name})`] = await slack.searchMessages(args.query as string, countPer)
        } catch (err: any) { results[`${workspace.name} (${workspace.team_name})`] = { error: err.message } }
      }
      return json(results)
    }

    default:
      return text(`Unknown tool: ${toolName}`)
  }
}
