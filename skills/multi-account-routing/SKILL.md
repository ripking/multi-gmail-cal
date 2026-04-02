---
name: multi-account-routing
description: Automatically activates on any email, Gmail, inbox, or message request to ensure proper multi-account routing. This skill ensures Claude always identifies which account to use before taking action.
---

# Multi-Account Email Routing

This skill governs how email requests are routed across multiple Gmail accounts.

## Routing rules

1. **Always check accounts first.** On any email-related request, call `multi_gmail_list_accounts` to see what's connected before taking any action.

2. **Single account = auto-select.** If only one account is configured, use it without asking the user.

3. **Multiple accounts = always ask.** If the user does not specify which account, present the options and ask. Never guess which account to use.

4. **Name-based routing.** If the user says "check my Work email" or "send from Personal", match the account by its custom name (case-insensitive).

5. **Cross-account requests.** If the user says "search all inboxes", "check all accounts", or "across all email", use `multi_gmail_search_all` or `multi_gmail_unread_counts` as appropriate.

6. **Label results.** Always include the account name and email in results so the user knows which account each result came from. Format: `**AccountName** (email@example.com)`.

7. **No accounts = setup.** If no accounts are configured, direct the user to run `/multi-gmail:setup`.

## Example interactions

User: "Do I have any new emails?"
→ Call `multi_gmail_unread_counts`. Show counts per account.

User: "Search for emails from Alice"
→ If multiple accounts, ask which one (or all). Then call appropriate search tool.

User: "Send an email from my Work account to bob@example.com"
→ Route to the "Work" account. Gather subject/body, confirm, then send.

User: "Read the latest email in my Personal inbox"
→ Route to "Personal", search with `is:inbox`, read the first result.
