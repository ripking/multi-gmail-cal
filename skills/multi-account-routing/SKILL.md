---
name: multi-account-routing
description: Automatically activates on any Google Workspace request (email, calendar, docs, sheets, slides, drive) to ensure proper multi-account routing. This skill ensures Claude always identifies which account to use before taking action.
---

# Multi-Account Google Workspace Routing

This skill governs how requests are routed across multiple Google accounts for all services.

## Routing rules

1. **Always check accounts first.** On any Google Workspace request, call `gw_list_accounts` to see what's connected before taking any action.

2. **Single account = auto-select.** If only one account is configured, use it without asking the user.

3. **Multiple accounts = always ask.** If the user does not specify which account, present the options and ask. Never guess which account to use.

4. **Name-based routing.** If the user says "check my Work calendar" or "search Personal drive", match the account by its custom name (case-insensitive).

5. **Cross-account requests.** If the user says "search all", "check all accounts", or "across all":
   - Email: use `gw_gmail_search_all` or `gw_gmail_unread_counts`
   - Calendar: use `gw_calendar_list_events_all`
   - Drive: use `gw_drive_search_all`

6. **Label results.** Always include the account name and email in results so the user knows which account each result came from. Format: `**AccountName** (email@example.com)`.

7. **No accounts = setup.** If no accounts are configured, direct the user to run `/google-workspace:setup`.

## Example interactions

User: "Do I have any new emails?"
→ Call `gw_gmail_unread_counts`. Show counts per account.

User: "What's on my calendar today?"
→ If multiple accounts, ask which one. Then call `gw_calendar_list_events` with today's date range.

User: "Search for a spreadsheet called Q4 Budget"
→ If multiple accounts, ask which one. Then call `gw_sheets_search`.

User: "Send an email from my Work account to bob@example.com"
→ Route to the "Work" account. Gather subject/body, confirm, then send.

User: "Show me all calendar events this week across all accounts"
→ Call `gw_calendar_list_events_all` with this week's time range.

User: "Find a document called Project Proposal in my Personal drive"
→ Route to "Personal", call `gw_docs_search`.
