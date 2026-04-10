---
name: setup
description: Set up the Google Workspace plugin — configure OAuth credentials and add accounts. Use when the user asks to "set up gmail", "configure email", "add google account", "connect email", or mentions Google Cloud OAuth setup.
user-invocable: true
allowed-tools:
  - Read
  - Bash(curl *)
  - Bash(ls *)
  - Bash(mkdir *)
---

# /google-workspace:setup — First-Time Setup

Guides the user through configuring OAuth and adding their first Google account.

Arguments passed: `$ARGUMENTS`

---

## Step 1: Check current state

1. Read `~/.claude/channels/google-workspace/config.json` (missing file = not configured yet, not an error).
2. Determine state:
   - **No config file** → OAuth not set up yet
   - **Config exists but no `oauth.client_id`** → OAuth not set up yet
   - **OAuth configured but no accounts** → Ready to add accounts
   - **OAuth configured and accounts exist** → Show status summary

## Step 2: Based on state

### If OAuth not configured:

Tell the user they need a Google Cloud project with OAuth credentials. Walk them through:

1. Go to https://console.cloud.google.com/ → create a new project (or use existing)
2. Enable these APIs under APIs & Services → Library:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Docs API**
   - **Google Sheets API**
   - **Google Slides API**
   - **Google Drive API**
3. Configure the **OAuth consent screen** (External is fine for personal use, add yourself as a test user)
4. Create **OAuth 2.0 Client ID** (type: **Desktop app**)
5. Copy the Client ID and Client Secret

Then tell them to:
1. Start the management panel: run `bun run panel` in the google-workspace plugin directory
2. Open http://localhost:5000 in their browser
3. Paste the Client ID and Secret into the OAuth Configuration section and save

### If OAuth configured but no accounts:

Check if the panel is running: `curl -s http://localhost:5000/health`

- **Panel running** → Tell the user to open http://localhost:5000 and click "Add Account" with a name like "Work" or "Personal"
- **Panel not running** → Tell the user to start it first: `bun run panel` in the plugin directory, then open http://localhost:5000

### If accounts exist:

Call `gw_list_accounts` to show the current state. Offer to help add more accounts via the panel if needed.

**Note:** If accounts were migrated from the old multi-gmail plugin, they may need to re-authenticate to get access to Calendar, Docs, Sheets, Slides, and Drive APIs. Check if operations beyond Gmail fail with auth errors.

---

## Implementation notes

- The management panel handles all OAuth browser flows — never try to do OAuth from within Claude.
- After adding an account in the panel, the MCP server picks it up immediately (it re-reads config on every tool call).
- If the user already has the panel open, changes appear after refreshing the page.
