# Multi-Gmail Plugin for Claude Code

Manage multiple Gmail accounts from Claude using custom names like "Work" and "Personal". Search, read, draft, send, and label emails across all your connected inboxes.

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or use an existing one)
2. Enable the **Gmail API**: APIs & Services → Library → search "Gmail API" → Enable
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

In Claude:
- `/multi-gmail:gmail list` — see connected accounts
- `/multi-gmail:gmail check` — unread counts
- `/multi-gmail:email search <query>` — search emails
- `/multi-gmail:email read <message>` — read an email
- `/multi-gmail:email draft <recipient>` — create a draft
- `/multi-gmail:email send <recipient>` — send an email

Or just ask naturally: "Check my Work email for anything from Alice this week"

## Architecture

- **MCP Server** (`server/server.ts`) — stdio transport, launched by Claude. Exposes 12 Gmail tools.
- **Management Panel** (`panel/panel.ts`) — localhost:5000 web dashboard for OAuth and account management.
- **Shared config** at `~/.claude/channels/multi-gmail/config.json` — tokens and account metadata.

## Development

```bash
bun install               # Install dependencies
bun run start             # Run MCP server (stdio — usually launched by Claude)
bun run panel             # Run management panel on localhost:5000
```

## MCP Tools

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
