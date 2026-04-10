# Google Workspace Plugin for Claude Code

Manage multiple Google accounts from Claude using custom names like "Work" and "Personal". Full access to Gmail, Calendar, Docs, Sheets, Slides, and Drive across all your connected accounts.

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or use an existing one)
2. Enable these APIs under APIs & Services → Library:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Docs API**
   - **Google Sheets API**
   - **Google Slides API**
   - **Google Drive API**
3. Configure **OAuth consent screen**: APIs & Services → OAuth consent screen
   - Choose "External" (fine for personal use)
   - Add your email as a test user
4. Create **OAuth credentials**: APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Desktop app**
   - Copy the **Client ID** and **Client Secret**

### 2. Install the Plugin

```bash
# From Claude Code, install the plugin:
/plugin install /path/to/google-workspace

# Or for development, use the plugin directory flag
claude --plugin-dir /path/to/google-workspace
```

### 3. Configure OAuth

```bash
# Start the management panel
cd /path/to/google-workspace
bun run panel
```

Open http://localhost:5000 in your browser:
1. Paste your Client ID and Client Secret → Save
2. Click **Add Account**, enter a name (e.g., "Work") → sign in with Google
3. Repeat for each additional account

### 4. Use It

In Claude:
- `/google-workspace:gmail list` — see connected accounts
- `/google-workspace:gmail check` — unread counts
- `/google-workspace:email search <query>` — search emails
- `/google-workspace:calendar list` — upcoming events
- `/google-workspace:drive search <query>` — search files
- `/google-workspace:docs get <name>` — read a document
- `/google-workspace:sheets read <name> <range>` — read spreadsheet data
- `/google-workspace:slides get <name>` — view a presentation

Or just ask naturally: "Check my Work email for anything from Alice this week" or "What's on my calendar today?"

## Architecture

- **MCP Server** (`server/server.ts`) — stdio transport, launched by Claude. Exposes 40 tools across 6 Google services.
- **HTTP Server** (`server/http-server.ts`) — Streamable HTTP transport for Claude Desktop at localhost:5001.
- **Management Panel** (`panel/panel.ts`) — localhost:5000 web dashboard for OAuth and account management.
- **Shared config** at `~/.claude/channels/google-workspace/config.json` — tokens and account metadata.
- **Auto-migration** — existing `~/.claude/channels/multi-gmail/config.json` is automatically migrated on first run.

## Development

```bash
bun install               # Install dependencies
bun run start             # Run MCP server (stdio — usually launched by Claude)
bun run serve             # Run HTTP server on localhost:5001
bun run panel             # Run management panel on localhost:5000
```

## MCP Tools

### Shared
| Tool | Description |
|------|-------------|
| `gw_list_accounts` | List all connected accounts |

### Gmail (12 tools)
| Tool | Description |
|------|-------------|
| `gw_gmail_get_profile` | Get account profile info |
| `gw_gmail_search` | Search messages (Gmail query syntax) |
| `gw_gmail_read_message` | Read a full message |
| `gw_gmail_read_thread` | Read all messages in a thread |
| `gw_gmail_create_draft` | Create a draft |
| `gw_gmail_send` | Send an email |
| `gw_gmail_list_drafts` | List drafts |
| `gw_gmail_list_labels` | List labels |
| `gw_gmail_modify_labels` | Add/remove labels |
| `gw_gmail_search_all` | Search across all accounts |
| `gw_gmail_unread_counts` | Unread count per account |

### Calendar (7 tools)
| Tool | Description |
|------|-------------|
| `gw_calendar_list_calendars` | List all calendars |
| `gw_calendar_list_events` | List upcoming events |
| `gw_calendar_get_event` | Get event details |
| `gw_calendar_create_event` | Create an event |
| `gw_calendar_update_event` | Update an event |
| `gw_calendar_delete_event` | Delete an event |
| `gw_calendar_list_events_all` | Events across all accounts |

### Drive (7 tools)
| Tool | Description |
|------|-------------|
| `gw_drive_list` | List files in a folder |
| `gw_drive_search` | Search files |
| `gw_drive_get` | Get file metadata |
| `gw_drive_create_folder` | Create a folder |
| `gw_drive_share` | Share a file |
| `gw_drive_download` | Download/export file content |
| `gw_drive_search_all` | Search across all accounts |

### Docs (4 tools)
| Tool | Description |
|------|-------------|
| `gw_docs_get` | Get document content |
| `gw_docs_create` | Create a new document |
| `gw_docs_append` | Append text to a document |
| `gw_docs_search` | Search documents by name |

### Sheets (5 tools)
| Tool | Description |
|------|-------------|
| `gw_sheets_get` | Get spreadsheet metadata |
| `gw_sheets_read` | Read cell data from a range |
| `gw_sheets_write` | Write data to a range |
| `gw_sheets_create` | Create a new spreadsheet |
| `gw_sheets_search` | Search spreadsheets by name |

### Slides (4 tools)
| Tool | Description |
|------|-------------|
| `gw_slides_get` | Get presentation content |
| `gw_slides_create` | Create a new presentation |
| `gw_slides_add_slide` | Add a slide |
| `gw_slides_search` | Search presentations by name |
