---
name: email
description: Quick email actions — search, read, draft, or send email across connected accounts. Use when user says "search email", "read message", "draft email", "send email", "find emails about", "check inbox", or any email action.
argument-hint: <search|read|draft|send> [args...]
user-invocable: true
---

# /google-workspace:email — Email Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically, no need to ask.
- **Multiple accounts** → ask the user which account (present names and emails). Exception: if the user said "all" or "every account", use cross-account tools.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `search <query>`

If the user wants to search all accounts, call `gw_gmail_search_all` with the query.

Otherwise, resolve the account and call `gw_gmail_search` with the query. Display results clearly:

```
1. Subject — From — Date
   Snippet preview...
```

Include the message ID so the user can ask to read a specific result.

### `read <subject or message ID>`

If the argument looks like a Gmail message ID, call `gw_gmail_read_message` directly.

If it's a subject or description, first search for it with `gw_gmail_search`, then read the best match. If the user wants the full thread, use `gw_gmail_read_thread` instead.

Present the message with clear headers (From, To, Date, Subject) followed by the body.

### `draft <recipient>`

1. Resolve which account to send from.
2. Ask for the subject and body if not provided in arguments.
3. Call `gw_gmail_create_draft` with the details.
4. Confirm with the draft ID: "Draft created. You can review it in Gmail or ask me to send it."

### `send <recipient>`

Same flow as `draft` but calls `gw_gmail_send`. Always confirm with the user before sending:

> Ready to send from **Work** (alice@company.com):
> To: bob@example.com
> Subject: Meeting tomorrow
> Body: ...
>
> Send this email?

Only call `gw_gmail_send` after the user confirms.

---

## Labels and organization

If the user asks to archive, star, or label a message, use `gw_gmail_modify_labels`:
- Archive = remove "INBOX" label
- Star = add "STARRED" label
- Mark read = remove "UNREAD" label
- Mark unread = add "UNREAD" label

Use `gw_gmail_list_labels` if the user references a custom label name and you need the label ID.
