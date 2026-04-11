# Multi-Gmail & Workspace Plugin for Claude Code

Manage multiple Google Workspace accounts (Gmail, Calendar, Drive, Docs, Sheets, Slides) and Slack workspaces from Claude using custom names like "Work" and "Personal".

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or use an existing one)
2. Enable the following APIs under APIs & Services → Library:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Drive API**
   - **Google Docs API**
   - **Google Sheets API**
   - **Google Slides API**
3. Configure **OAuth consent screen**: APIs & Services → OAuth consent screen
   - Choose "External" (fine for personal use)
   - Add your email as a test user
4. Create **OAuth credentials**: APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Desktop app**
   - Copy the **Client ID** and **Client Secret**

### 2. Install the Plugin

```bash
# From Claude Code, install the plugin:
/plugin install /path/to/multi-gmail

# Or for development, use the plugin directory flag
claude --plugin-dir /path/to/multi-gmail
```

### 3. Configure OAuth

```bash
# Start the management panel
cd /path/to/multi-gmail
bun run panel
```

Open http://localhost:5000 in your browser:
1. Paste your Client ID and Client Secret → Save
2. Click **Add Account**, enter a name (e.g., "Work") → sign in with Google
3. Repeat for each additional account

### 4. Use It

In Claude, just ask naturally:
- "Check my Work email for anything from Alice this week"
- "What's on my calendar today?"
- "Search for the budget spreadsheet in Drive"
- "Create a new Google Doc called Meeting Notes"
- "Post in #general on Slack"

## Architecture

- **MCP Server** (`server/server.ts`) — stdio transport, launched by Claude Code. Exposes all tools.
- **HTTP Server** (`server/http-server.ts`) — Streamable HTTP transport at `localhost:5001/mcp` for Claude Desktop.
- **Management Panel** (`panel/panel.ts`) — localhost:5000 web dashboard for OAuth and account management.
- **Shared config** at `~/.claude/channels/multi-gmail/config.json` — tokens and account metadata.

## Development

```bash
bun install               # Install dependencies
bun run start             # Run MCP server (stdio — usually launched by Claude)
bun run serve             # Run HTTP server for Claude Desktop (localhost:5001)
bun run panel             # Run management panel on localhost:5000
```

## MCP Tools

### Gmail

| Tool | Description |
|------|-------------|
| `multi_gmail_list_accounts` | List connected accounts |
| `multi_gmail_get_profile` | Get account profile info |
| `multi_gmail_search` | Search messages (Gmail query syntax) |
| `multi_gmail_read_message` | Read a full message |
| `multi_gmail_read_thread` | Read all messages in a thread |
| `multi_gmail_create_draft` | Create a draft |
| `multi_gmail_send` | Send an email |
| `multi_gmail_list_drafts` | List drafts |
| `multi_gmail_list_labels` | List labels |
| `multi_gmail_modify_labels` | Add/remove labels |
| `multi_gmail_search_all` | Search across all accounts |
| `multi_gmail_unread_counts` | Unread count per account |

### Calendar

| Tool | Description |
|------|-------------|
| `gw_calendar_list_calendars` | List all calendars (primary, shared, subscribed) |
| `gw_calendar_list_events` | List upcoming events |
| `gw_calendar_get_event` | Get event details |
| `gw_calendar_create_event` | Create a new event |
| `gw_calendar_update_event` | Update an existing event |
| `gw_calendar_delete_event` | Delete an event |
| `gw_calendar_list_events_all` | List events across all accounts |

### Drive

| Tool | Description |
|------|-------------|
| `gw_drive_list` | List files in a folder |
| `gw_drive_search` | Search files by name |
| `gw_drive_get` | Get file metadata |
| `gw_drive_create_folder` | Create a folder |
| `gw_drive_share` | Share a file or folder |
| `gw_drive_download` | Download/export file content |
| `gw_drive_search_all` | Search files across all accounts |

### Docs

| Tool | Description |
|------|-------------|
| `gw_docs_get` | Get document content as plain text |
| `gw_docs_create` | Create a new document |
| `gw_docs_append` | Append text to a document |
| `gw_docs_search` | Search documents by name |

### Sheets

| Tool | Description |
|------|-------------|
| `gw_sheets_get` | Get spreadsheet metadata |
| `gw_sheets_read` | Read cell data from a range |
| `gw_sheets_write` | Write data to a range |
| `gw_sheets_create` | Create a new spreadsheet |
| `gw_sheets_search` | Search spreadsheets by name |

### Slides

| Tool | Description |
|------|-------------|
| `gw_slides_get` | Get presentation metadata and content |
| `gw_slides_create` | Create a new presentation |
| `gw_slides_add_slide` | Add a slide to a presentation |
| `gw_slides_search` | Search presentations by name |

### Slack

| Tool | Description |
|------|-------------|
| `multi_slack_list_workspaces` | List connected workspaces |
| `multi_slack_list_channels` | List channels |
| `multi_slack_read_channel_history` | Read recent messages |
| `multi_slack_post_message` | Post a message |
| `multi_slack_reply_to_thread` | Reply to a thread |
| `multi_slack_search_messages` | Search messages |
| `multi_slack_list_users` | List users |
| `multi_slack_get_user_info` | Get user details |
| `multi_slack_add_reaction` | Add an emoji reaction |
| `multi_slack_search_all` | Search across all workspaces |
