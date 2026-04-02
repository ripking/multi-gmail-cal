# Multi-Gmail Plugin — Implementation Spec

## Problem
Claude Cowork's built-in Gmail connector only allows one Gmail account through the GUI. There's no way to add a second. The user wants to manage multiple approved Gmail accounts (read, search, draft, send, label) from within Cowork using custom names like "Work" and "Personal."

## Solution
Build a Cowork plugin containing a local MCP server (Node.js, stdio transport) that authenticates with the Gmail API independently for each account via OAuth2. The plugin also includes a skill and commands that teach Claude how to route requests across accounts.

## Architecture
```
multi-gmail/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .mcp.json                    # Points Cowork at the local MCP server
├── server/
│   ├── package.json
│   ├── index.js                 # MCP server entry point (stdio)
│   ├── gmail-client.js          # Gmail API wrapper (per-account)
│   ├── auth.js                  # OAuth2 flow manager
│   └── store.js                 # Token + account config persistence
├── commands/
│   ├── gmail.md                 # /gmail — account management
│   └── email.md                 # /email — quick actions
├── skills/
│   └── multi-account-gmail/
│       ├── SKILL.md             # Core routing logic for Claude
│       └── references/
│           └── account-patterns.md
└── README.md
```

## MCP Server (server/)

### Transport

- stdio — Cowork launches it as a child process
- Uses `@modelcontextprotocol/sdk` for the MCP protocol layer
- Uses `googleapis` (`google-auth-library` + gmail v1) for Gmail API access

### Config & Token Storage
All persistent state lives in a single JSON file at a user-configurable path (default: `~/.multi-gmail/config.json`). Structure:

```json
{
  "oauth": {
    "client_id": "...",
    "client_secret": "...",
    "redirect_uri": "http://localhost:5000/oauth/callback"
  },
  "accounts": [
    {
      "name": "Work",
      "email": "alice@company.com",
      "tokens": {
        "access_token": "...",
        "refresh_token": "...",
        "expiry_date": 1234567890
      }
    },
    {
      "name": "Personal",
      "email": "alice@gmail.com",
      "tokens": { "..." : "..." }
    }
  ]
}
```

The `oauth.client_id` and `oauth.client_secret` come from the user's Google Cloud project (see Setup below). They're shared across all accounts — only the tokens differ.

### OAuth2 Flow
When adding a new account:

1. Server spins up a temporary HTTP listener on `localhost:5000`
2. Generates a Google OAuth2 authorization URL with scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
3. Returns the URL to Claude, which presents it to the user
4. User signs in, grants consent, Google redirects to `localhost:5000/oauth/callback?code=...`
5. Server exchanges the code for access + refresh tokens
6. Server calls `gmail.users.getProfile` to get the email address
7. Stores the tokens and email in `config.json`
8. Shuts down the temporary listener

Token refresh happens automatically via `google-auth-library` when an access token expires.

### MCP Tools to Expose
Every tool takes an `account` parameter (string) — matched by custom name or email address. If omitted or ambiguous, the tool returns an error listing available accounts so Claude can ask the user.

#### Account Management

| Tool | Params | Description |
|------|--------|-------------|
| `multi_gmail_add_account` | `name` (string) | Start OAuth flow to add a new account with the given name. Returns auth URL. |
| `multi_gmail_complete_auth` | `name` (string) | Check if the OAuth callback was received for a pending auth. Returns success/failure. |
| `multi_gmail_remove_account` | `account` (string) | Remove an account and delete its tokens. |
| `multi_gmail_rename_account` | `account` (string), `new_name` (string) | Rename an account. |
| `multi_gmail_list_accounts` | (none) | List all accounts with name, email, and status (token valid/expired). |

#### Email Operations

| Tool | Params | Description |
|------|--------|-------------|
| `multi_gmail_get_profile` | `account` | Get profile info (email, messages total, threads total, history ID). |
| `multi_gmail_search` | `account`, `query` (string), `max_results` (number, default 10) | Search messages using Gmail query syntax. Returns message ID, thread ID, subject, from, date, snippet. |
| `multi_gmail_read_message` | `account`, `message_id` (string) | Read full message — headers, body (prefer text/plain, fall back to text/html stripped), attachments list. |
| `multi_gmail_read_thread` | `account`, `thread_id` (string) | Read all messages in a thread. |
| `multi_gmail_create_draft` | `account`, `to` (string), `subject` (string), `body` (string), `cc` (string, optional), `bcc` (string, optional), `in_reply_to` (string, optional — message ID for replies) | Create a draft. Returns draft ID. |
| `multi_gmail_send` | `account`, `to`, `subject`, `body`, `cc`, `bcc`, `in_reply_to` | Send an email directly. Returns message ID. |
| `multi_gmail_list_drafts` | `account`, `max_results` (number, default 10) | List drafts with subject and snippet. |
| `multi_gmail_list_labels` | `account` | List all labels (system + user-created). |
| `multi_gmail_modify_labels` | `account`, `message_id`, `add_labels` (string[], optional), `remove_labels` (string[], optional) | Add/remove labels from a message (useful for archiving, starring, etc). |

#### Cross-Account

| Tool | Params | Description |
|------|--------|-------------|
| `multi_gmail_search_all` | `query` (string), `max_results` (number, default 5 per account) | Search across ALL accounts. Returns results grouped by account. |
| `multi_gmail_unread_counts` | (none) | Returns unread count for each account. |

### Error Handling

- If `account` param doesn't match any known account → return error with list of valid account names
- If token is expired and refresh fails → return error indicating re-auth needed, with instructions
- If Google API returns a rate limit error → return the error clearly
- If no accounts are configured → return error telling user to run `multi_gmail_add_account` first

## .mcp.json

```json
{
  "mcpServers": {
    "multi-gmail": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/index.js"],
      "env": {
        "MULTI_GMAIL_CONFIG": "~/.multi-gmail/config.json"
      }
    }
  }
}
```

## Plugin Manifest (.claude-plugin/plugin.json)

```json
{
  "name": "multi-gmail",
  "version": "0.1.0",
  "description": "Manage multiple Gmail accounts with custom names — search, draft, send, and read across all your connected inboxes",
  "author": {
    "name": "Ethan"
  },
  "keywords": ["gmail", "email", "multi-account"]
}
```

## Skill: multi-account-gmail
The skill (`skills/multi-account-gmail/SKILL.md`) teaches Claude the routing behavior:

**Trigger phrases:** "check email", "send email", "draft an email", "search inbox", "read messages", "manage Gmail accounts", "list email accounts", "switch email account", or any Gmail-related action.

**Core behavior:**

1. On any email-related request, first call `multi_gmail_list_accounts` to see what's connected.
2. If the user specifies an account by name → route to that account.
3. If the user does NOT specify → always ask using `AskUserQuestion`, presenting account names and emails.
4. If only one account exists → use it without asking.
5. For cross-account requests ("search all inboxes") → use `multi_gmail_search_all` or loop through accounts.
6. Always label results with the account name and email.

## Commands

### /gmail (commands/gmail.md)
Subcommands:

- `list` (default) — call `multi_gmail_list_accounts`, display names + emails + status
- `add <name>` — call `multi_gmail_add_account`, present the auth URL, then call `multi_gmail_complete_auth` to confirm
- `remove <name>` — call `multi_gmail_remove_account` after confirming with user
- `rename <old> <new>` — call `multi_gmail_rename_account`
- `check` — call `multi_gmail_unread_counts`, display summary table

### /email (commands/email.md)
Subcommands:

- `search <query>` — ask which account (or all), call `multi_gmail_search` or `multi_gmail_search_all`
- `read <subject or ID>` — resolve account, call `multi_gmail_read_message`
- `draft <recipient>` — ask which account to send from, gather subject/body, call `multi_gmail_create_draft`
- `send <recipient>` — same as draft but calls `multi_gmail_send`

## One-Time Setup (for README)
The user needs a Google Cloud project with OAuth credentials. Steps to document:

1. Go to https://console.cloud.google.com/ → create a new project (or use existing)
2. Enable the Gmail API under APIs & Services → Library
3. Configure the OAuth consent screen (External is fine for personal use, add yourself as a test user)
4. Create OAuth 2.0 Client ID (type: Desktop app)
5. Copy the Client ID and Client Secret
6. Run `/gmail setup` — Claude will ask for the client ID and secret, save them to `~/.multi-gmail/config.json`
7. Run `/gmail add Work` — follow the auth URL to sign in with the first account
8. Repeat `/gmail add Personal` for each additional account

## Key Design Decisions

1. **stdio transport** — simplest for a plugin-bundled server; Cowork manages the process lifecycle
2. **Single config file** — tokens and account metadata in one place, easy to back up or reset
3. **Custom names as the primary identifier** — the `account` param on every tool uses the name, not the email, making it natural for Claude to say "checking your Work email"
4. **Always-ask routing** — when the user doesn't specify an account, Claude must ask; it never guesses
5. **Shared OAuth client** — one Google Cloud project, one client ID/secret, multiple accounts authenticated under it
6. **Localhost callback** — the OAuth redirect goes to a temporary local HTTP server, no external hosting needed
