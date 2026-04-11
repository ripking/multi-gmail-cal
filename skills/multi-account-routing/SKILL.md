---
name: multi-account-routing
description: Automatically activates on any Google Workspace or Slack request to ensure proper multi-account routing. This skill ensures Claude always identifies which account or workspace to use before taking action.
---

# Multi-Account Routing

This skill governs how requests are routed across multiple Google Workspace accounts and Slack workspaces.

## Google Workspace routing rules

All Google tools (multi_gmail_*, gw_calendar_*, gw_drive_*, gw_docs_*, gw_sheets_*, gw_slides_*) use the `account` parameter.

1. **Always check accounts first.** On any Google Workspace request, call `multi_gmail_list_accounts` to see what's connected before taking any action.

2. **Single account = auto-select.** If only one account is configured, use it without asking the user.

3. **Multiple accounts = always ask.** If the user does not specify which account, present the options and ask. Never guess which account to use.

4. **Name-based routing.** If the user says "check my Work email" or "look at Personal calendar", match the account by its custom name (case-insensitive).

5. **Cross-account requests.** If the user says "search all inboxes", "check all calendars", or "across all accounts", use the appropriate cross-account tool:
   - `multi_gmail_search_all` or `multi_gmail_unread_counts` for email
   - `gw_calendar_list_events_all` for calendar events
   - `gw_drive_search_all` for files

6. **Label results.** Always include the account name and email in results so the user knows which account each result came from. Format: `**AccountName** (email@example.com)`.

7. **No accounts = setup.** If no accounts are configured, direct the user to run `/multi-gmail:setup`.

## Slack routing rules

All Slack tools (multi_slack_*) use the `workspace` parameter.

1. **Always check workspaces first.** Call `multi_slack_list_workspaces` to see what's connected.

2. **Single workspace = auto-select.** If only one workspace is configured, use it automatically.

3. **Multiple workspaces = always ask.** If the user doesn't specify which workspace, present options and ask.

4. **Name-based routing.** Match by custom name or team name (case-insensitive).

5. **Cross-workspace search.** Use `multi_slack_search_all` when the user says "search all workspaces".

## Example interactions

User: "Do I have any new emails?"
→ Call `multi_gmail_unread_counts`. Show counts per account.

User: "What's on my calendar today?"
→ If multiple accounts, ask which one (or all). Then call `gw_calendar_list_events`.

User: "Search for the budget spreadsheet"
→ Resolve account, then call `gw_drive_search` or `gw_sheets_search`.

User: "Send an email from my Work account to bob@example.com"
→ Route to the "Work" account. Gather subject/body, confirm, then send.

User: "Post in the #general channel"
→ Resolve workspace, then call `multi_slack_post_message`.

User: "Search all inboxes for messages from Alice"
→ Call `multi_gmail_search_all` with the query.
