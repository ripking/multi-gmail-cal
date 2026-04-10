/**
 * Shared tool definitions and handler for the Google Workspace MCP server.
 * Imported by both server.ts (stdio) and http-server.ts (HTTP).
 */

import { readConfig, findAccount, listAccountSummaries, accountNames } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from './gmail-client.ts'
import { CalendarClient } from './calendar-client.ts'
import { DriveClient } from './drive-client.ts'
import { DocsClient } from './docs-client.ts'
import { SheetsClient } from './sheets-client.ts'
import { SlidesClient } from './slides-client.ts'
import type { Account, GoogleWorkspaceConfig } from '../shared/types.ts'
import type { OAuth2Client } from 'google-auth-library'

// --- Response helpers ---

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
  fn: (auth: OAuth2Client, account: Account, config: GoogleWorkspaceConfig) => Promise<unknown>
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

export const tools = [
  // === Shared ===
  {
    name: 'gw_list_accounts',
    description: 'List all connected Google accounts with name, email, and token status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // === Gmail ===
  {
    name: 'gw_gmail_get_profile',
    description: 'Get Gmail profile info (email, total messages, total threads).',
    inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] },
  },
  {
    name: 'gw_gmail_search',
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
    name: 'gw_gmail_read_message',
    description: 'Read a full email message — headers, body, and attachment list.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, message_id: { type: 'string' as const, description: 'Gmail message ID' } },
      required: ['account', 'message_id'],
    },
  },
  {
    name: 'gw_gmail_read_thread',
    description: 'Read all messages in an email thread.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, thread_id: { type: 'string' as const, description: 'Gmail thread ID' } },
      required: ['account', 'thread_id'],
    },
  },
  {
    name: 'gw_gmail_create_draft',
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
    name: 'gw_gmail_send',
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
    name: 'gw_gmail_list_drafts',
    description: 'List drafts with subject and snippet.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, max_results: { type: 'number' as const, description: 'Maximum results (default 10)' } },
      required: ['account'],
    },
  },
  {
    name: 'gw_gmail_list_labels',
    description: 'List all Gmail labels (system and user-created).',
    inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] },
  },
  {
    name: 'gw_gmail_modify_labels',
    description: 'Add or remove labels from a message (archive, star, categorize, etc).',
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
    name: 'gw_gmail_search_all',
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
    name: 'gw_gmail_unread_counts',
    description: 'Get unread inbox count for each connected account.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // === Calendar ===
  {
    name: 'gw_calendar_list_calendars',
    description: 'List all calendars for the account (primary, shared, subscribed).',
    inputSchema: { type: 'object' as const, properties: ACCOUNT_PARAM, required: ['account'] },
  },
  {
    name: 'gw_calendar_list_events',
    description: 'List upcoming events from a calendar. Defaults to primary calendar.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' },
        time_min: { type: 'string' as const, description: 'Start of time range (ISO 8601, e.g., "2025-01-01T00:00:00Z"). Defaults to now.' },
        time_max: { type: 'string' as const, description: 'End of time range (ISO 8601). Defaults to 7 days from now.' },
        max_results: { type: 'number' as const, description: 'Maximum events to return (default 20)' },
      },
      required: ['account'],
    },
  },
  {
    name: 'gw_calendar_get_event',
    description: 'Get full details of a calendar event by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' },
        event_id: { type: 'string' as const, description: 'Event ID' },
      },
      required: ['account', 'event_id'],
    },
  },
  {
    name: 'gw_calendar_create_event',
    description: 'Create a new calendar event. Returns event ID and link.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' },
        summary: { type: 'string' as const, description: 'Event title' },
        start: { type: 'string' as const, description: 'Start time (ISO 8601, e.g., "2025-06-15T10:00:00-04:00")' },
        end: { type: 'string' as const, description: 'End time (ISO 8601)' },
        description: { type: 'string' as const, description: 'Event description (optional)' },
        location: { type: 'string' as const, description: 'Event location (optional)' },
        attendees: { type: 'array' as const, items: { type: 'string' as const }, description: 'Attendee email addresses (optional)' },
      },
      required: ['account', 'summary', 'start', 'end'],
    },
  },
  {
    name: 'gw_calendar_update_event',
    description: 'Update fields on an existing calendar event.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' },
        event_id: { type: 'string' as const, description: 'Event ID' },
        summary: { type: 'string' as const, description: 'New event title' },
        start: { type: 'string' as const, description: 'New start time (ISO 8601)' },
        end: { type: 'string' as const, description: 'New end time (ISO 8601)' },
        description: { type: 'string' as const, description: 'New description' },
        location: { type: 'string' as const, description: 'New location' },
        attendees: { type: 'array' as const, items: { type: 'string' as const }, description: 'New attendee list (replaces existing)' },
      },
      required: ['account', 'event_id'],
    },
  },
  {
    name: 'gw_calendar_delete_event',
    description: 'Delete a calendar event.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        calendar_id: { type: 'string' as const, description: 'Calendar ID (default: "primary")' },
        event_id: { type: 'string' as const, description: 'Event ID to delete' },
      },
      required: ['account', 'event_id'],
    },
  },
  {
    name: 'gw_calendar_list_events_all',
    description: 'List upcoming events across ALL connected accounts. Returns events grouped by account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        time_min: { type: 'string' as const, description: 'Start of time range (ISO 8601). Defaults to now.' },
        time_max: { type: 'string' as const, description: 'End of time range (ISO 8601). Defaults to 7 days from now.' },
        max_results: { type: 'number' as const, description: 'Max events per account (default 10)' },
      },
    },
  },

  // === Drive ===
  {
    name: 'gw_drive_list',
    description: 'List files in a Drive folder. Defaults to root.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        folder_id: { type: 'string' as const, description: 'Folder ID (default: "root")' },
        max_results: { type: 'number' as const, description: 'Maximum files to return (default 20)' },
      },
      required: ['account'],
    },
  },
  {
    name: 'gw_drive_search',
    description: 'Search for files in Drive by name, type, or content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Search query (file name or keywords)' },
        mime_type: { type: 'string' as const, description: 'Filter by MIME type (e.g., "application/vnd.google-apps.spreadsheet")' },
        max_results: { type: 'number' as const, description: 'Maximum results (default 20)' },
      },
      required: ['account', 'query'],
    },
  },
  {
    name: 'gw_drive_get',
    description: 'Get file metadata — name, type, size, owners, shared status, web link.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, file_id: { type: 'string' as const, description: 'Drive file ID' } },
      required: ['account', 'file_id'],
    },
  },
  {
    name: 'gw_drive_create_folder',
    description: 'Create a new folder in Drive.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        name: { type: 'string' as const, description: 'Folder name' },
        parent_id: { type: 'string' as const, description: 'Parent folder ID (default: root)' },
      },
      required: ['account', 'name'],
    },
  },
  {
    name: 'gw_drive_share',
    description: 'Share a file or folder with a user or make it public.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        file_id: { type: 'string' as const, description: 'File or folder ID' },
        email: { type: 'string' as const, description: 'Email to share with (omit for public link)' },
        role: { type: 'string' as const, description: 'Permission role: "reader", "writer", or "commenter" (default: "reader")' },
      },
      required: ['account', 'file_id'],
    },
  },
  {
    name: 'gw_drive_download',
    description: 'Download or export file content (text-based files only). Google Docs/Sheets/Slides are exported as plain text/CSV.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, file_id: { type: 'string' as const, description: 'Drive file ID' } },
      required: ['account', 'file_id'],
    },
  },
  {
    name: 'gw_drive_search_all',
    description: 'Search files across ALL connected accounts. Returns results grouped by account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
        max_results: { type: 'number' as const, description: 'Max results per account (default 5)' },
      },
      required: ['query'],
    },
  },

  // === Docs ===
  {
    name: 'gw_docs_get',
    description: "Get a Google Doc's content as plain text.",
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, document_id: { type: 'string' as const, description: 'Google Docs document ID' } },
      required: ['account', 'document_id'],
    },
  },
  {
    name: 'gw_docs_create',
    description: 'Create a new Google Doc with a title. Returns document ID and link.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Document title' } },
      required: ['account', 'title'],
    },
  },
  {
    name: 'gw_docs_append',
    description: 'Append text to the end of a Google Doc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        document_id: { type: 'string' as const, description: 'Google Docs document ID' },
        text: { type: 'string' as const, description: 'Text to append' },
      },
      required: ['account', 'document_id', 'text'],
    },
  },
  {
    name: 'gw_docs_search',
    description: 'Search for Google Docs by name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Search query (document name)' },
        max_results: { type: 'number' as const, description: 'Maximum results (default 20)' },
      },
      required: ['account', 'query'],
    },
  },

  // === Sheets ===
  {
    name: 'gw_sheets_get',
    description: 'Get spreadsheet metadata — sheet names, row/column counts, properties.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, spreadsheet_id: { type: 'string' as const, description: 'Google Sheets spreadsheet ID' } },
      required: ['account', 'spreadsheet_id'],
    },
  },
  {
    name: 'gw_sheets_read',
    description: 'Read cell data from a sheet range (e.g., "Sheet1!A1:D10").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        spreadsheet_id: { type: 'string' as const, description: 'Google Sheets spreadsheet ID' },
        range: { type: 'string' as const, description: 'Cell range in A1 notation (e.g., "Sheet1!A1:D10")' },
      },
      required: ['account', 'spreadsheet_id', 'range'],
    },
  },
  {
    name: 'gw_sheets_write',
    description: 'Write data to a sheet range. Values is a 2D array (rows of columns).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        spreadsheet_id: { type: 'string' as const, description: 'Google Sheets spreadsheet ID' },
        range: { type: 'string' as const, description: 'Cell range in A1 notation (e.g., "Sheet1!A1")' },
        values: {
          type: 'array' as const,
          items: { type: 'array' as const, items: { type: 'string' as const } },
          description: 'Data to write: array of rows, each row is an array of cell values',
        },
      },
      required: ['account', 'spreadsheet_id', 'range', 'values'],
    },
  },
  {
    name: 'gw_sheets_create',
    description: 'Create a new Google Sheets spreadsheet. Returns spreadsheet ID and link.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Spreadsheet title' } },
      required: ['account', 'title'],
    },
  },
  {
    name: 'gw_sheets_search',
    description: 'Search for Google Sheets spreadsheets by name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Search query (spreadsheet name)' },
        max_results: { type: 'number' as const, description: 'Maximum results (default 20)' },
      },
      required: ['account', 'query'],
    },
  },

  // === Slides ===
  {
    name: 'gw_slides_get',
    description: 'Get presentation metadata — slide count, titles, and content summary.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, presentation_id: { type: 'string' as const, description: 'Google Slides presentation ID' } },
      required: ['account', 'presentation_id'],
    },
  },
  {
    name: 'gw_slides_create',
    description: 'Create a new Google Slides presentation. Returns presentation ID and link.',
    inputSchema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_PARAM, title: { type: 'string' as const, description: 'Presentation title' } },
      required: ['account', 'title'],
    },
  },
  {
    name: 'gw_slides_add_slide',
    description: 'Add a new slide to a presentation. Optionally specify layout.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        presentation_id: { type: 'string' as const, description: 'Google Slides presentation ID' },
        layout: { type: 'string' as const, description: 'Predefined layout: "BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_ONLY", "SECTION_HEADER" (default: "BLANK")' },
        insertion_index: { type: 'number' as const, description: 'Position to insert the slide (0-indexed). Defaults to end.' },
      },
      required: ['account', 'presentation_id'],
    },
  },
  {
    name: 'gw_slides_search',
    description: 'Search for Google Slides presentations by name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...ACCOUNT_PARAM,
        query: { type: 'string' as const, description: 'Search query (presentation name)' },
        max_results: { type: 'number' as const, description: 'Maximum results (default 20)' },
      },
      required: ['account', 'query'],
    },
  },
]

// --- Tool call handler ---

export async function handleToolCall(toolName: string, args: Record<string, unknown>) {
  switch (toolName) {
    // === Shared ===
    case 'gw_list_accounts': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      return json(listAccountSummaries(config))
    }

    // === Gmail ===
    case 'gw_gmail_get_profile':
      return withAccount(args, async (auth) => new GmailClient(auth).getProfile())

    case 'gw_gmail_search':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).search(args.query as string, (args.max_results as number) || 10))

    case 'gw_gmail_read_message':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).readMessage(args.message_id as string))

    case 'gw_gmail_read_thread':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).readThread(args.thread_id as string))

    case 'gw_gmail_create_draft':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).createDraft({
          to: args.to as string, subject: args.subject as string, body: args.body as string,
          cc: args.cc as string | undefined, bcc: args.bcc as string | undefined,
          inReplyTo: args.in_reply_to as string | undefined,
        }))

    case 'gw_gmail_send':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).send({
          to: args.to as string, subject: args.subject as string, body: args.body as string,
          cc: args.cc as string | undefined, bcc: args.bcc as string | undefined,
          inReplyTo: args.in_reply_to as string | undefined,
        }))

    case 'gw_gmail_list_drafts':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).listDrafts((args.max_results as number) || 10))

    case 'gw_gmail_list_labels':
      return withAccount(args, async (auth) => new GmailClient(auth).listLabels())

    case 'gw_gmail_modify_labels':
      return withAccount(args, async (auth) =>
        new GmailClient(auth).modifyLabels(
          args.message_id as string,
          args.add_labels as string[] | undefined,
          args.remove_labels as string[] | undefined))

    case 'gw_gmail_search_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const maxPer = (args.max_results as number) || 5
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new GmailClient(auth).search(args.query as string, maxPer)
        } catch (err: any) {
          results[`${account.name} (${account.email})`] = { error: err.message }
        }
      }
      return json(results)
    }

    case 'gw_gmail_unread_counts': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const counts: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          counts[`${account.name} (${account.email})`] = await new GmailClient(auth).getUnreadCount()
        } catch (err: any) {
          counts[`${account.name} (${account.email})`] = { error: err.message }
        }
      }
      return json(counts)
    }

    // === Calendar ===
    case 'gw_calendar_list_calendars':
      return withAccount(args, async (auth) => new CalendarClient(auth).listCalendars())

    case 'gw_calendar_list_events':
      return withAccount(args, async (auth) =>
        new CalendarClient(auth).listEvents(
          args.calendar_id as string | undefined,
          args.time_min as string | undefined,
          args.time_max as string | undefined,
          (args.max_results as number) || 20))

    case 'gw_calendar_get_event':
      return withAccount(args, async (auth) =>
        new CalendarClient(auth).getEvent(args.event_id as string, args.calendar_id as string | undefined))

    case 'gw_calendar_create_event':
      return withAccount(args, async (auth) =>
        new CalendarClient(auth).createEvent({
          calendarId: args.calendar_id as string | undefined,
          summary: args.summary as string, start: args.start as string, end: args.end as string,
          description: args.description as string | undefined,
          location: args.location as string | undefined,
          attendees: args.attendees as string[] | undefined,
        }))

    case 'gw_calendar_update_event':
      return withAccount(args, async (auth) =>
        new CalendarClient(auth).updateEvent({
          calendarId: args.calendar_id as string | undefined,
          eventId: args.event_id as string,
          summary: args.summary as string | undefined,
          start: args.start as string | undefined,
          end: args.end as string | undefined,
          description: args.description as string | undefined,
          location: args.location as string | undefined,
          attendees: args.attendees as string[] | undefined,
        }))

    case 'gw_calendar_delete_event':
      return withAccount(args, async (auth) =>
        new CalendarClient(auth).deleteEvent(args.event_id as string, args.calendar_id as string | undefined))

    case 'gw_calendar_list_events_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new CalendarClient(auth).listEvents(
            undefined, args.time_min as string | undefined,
            args.time_max as string | undefined, (args.max_results as number) || 10)
        } catch (err: any) {
          results[`${account.name} (${account.email})`] = { error: err.message }
        }
      }
      return json(results)
    }

    // === Drive ===
    case 'gw_drive_list':
      return withAccount(args, async (auth) =>
        new DriveClient(auth).listFiles(args.folder_id as string | undefined, (args.max_results as number) || 20))

    case 'gw_drive_search':
      return withAccount(args, async (auth) =>
        new DriveClient(auth).search(args.query as string, args.mime_type as string | undefined, (args.max_results as number) || 20))

    case 'gw_drive_get':
      return withAccount(args, async (auth) => new DriveClient(auth).getFile(args.file_id as string))

    case 'gw_drive_create_folder':
      return withAccount(args, async (auth) =>
        new DriveClient(auth).createFolder(args.name as string, args.parent_id as string | undefined))

    case 'gw_drive_share':
      return withAccount(args, async (auth) =>
        new DriveClient(auth).share(args.file_id as string, args.email as string | undefined, (args.role as string) || 'reader'))

    case 'gw_drive_download':
      return withAccount(args, async (auth) => new DriveClient(auth).download(args.file_id as string))

    case 'gw_drive_search_all': {
      const config = readConfig()
      if (config.accounts.length === 0) return noAccounts()
      const maxPer = (args.max_results as number) || 5
      const results: Record<string, unknown> = {}
      for (const account of config.accounts) {
        try {
          const auth = await getAuthenticatedClient(config, account)
          results[`${account.name} (${account.email})`] = await new DriveClient(auth).search(args.query as string, undefined, maxPer)
        } catch (err: any) {
          results[`${account.name} (${account.email})`] = { error: err.message }
        }
      }
      return json(results)
    }

    // === Docs ===
    case 'gw_docs_get':
      return withAccount(args, async (auth) => new DocsClient(auth).getDocument(args.document_id as string))

    case 'gw_docs_create':
      return withAccount(args, async (auth) => new DocsClient(auth).createDocument(args.title as string))

    case 'gw_docs_append':
      return withAccount(args, async (auth) =>
        new DocsClient(auth).appendText(args.document_id as string, args.text as string))

    case 'gw_docs_search':
      return withAccount(args, async (auth) =>
        new DocsClient(auth).search(args.query as string, (args.max_results as number) || 20))

    // === Sheets ===
    case 'gw_sheets_get':
      return withAccount(args, async (auth) => new SheetsClient(auth).getSpreadsheet(args.spreadsheet_id as string))

    case 'gw_sheets_read':
      return withAccount(args, async (auth) =>
        new SheetsClient(auth).readRange(args.spreadsheet_id as string, args.range as string))

    case 'gw_sheets_write':
      return withAccount(args, async (auth) =>
        new SheetsClient(auth).writeRange(args.spreadsheet_id as string, args.range as string, args.values as string[][]))

    case 'gw_sheets_create':
      return withAccount(args, async (auth) => new SheetsClient(auth).createSpreadsheet(args.title as string))

    case 'gw_sheets_search':
      return withAccount(args, async (auth) =>
        new SheetsClient(auth).search(args.query as string, (args.max_results as number) || 20))

    // === Slides ===
    case 'gw_slides_get':
      return withAccount(args, async (auth) => new SlidesClient(auth).getPresentation(args.presentation_id as string))

    case 'gw_slides_create':
      return withAccount(args, async (auth) => new SlidesClient(auth).createPresentation(args.title as string))

    case 'gw_slides_add_slide':
      return withAccount(args, async (auth) =>
        new SlidesClient(auth).addSlide(args.presentation_id as string, args.layout as string | undefined, args.insertion_index as number | undefined))

    case 'gw_slides_search':
      return withAccount(args, async (auth) =>
        new SlidesClient(auth).search(args.query as string, (args.max_results as number) || 20))

    default:
      return text(`Unknown tool: ${toolName}`)
  }
}
