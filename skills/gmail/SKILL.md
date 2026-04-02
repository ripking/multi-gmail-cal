---
name: gmail
description: Manage Gmail accounts — list connected accounts, check unread counts, or get account status. Use when user says "list accounts", "check email", "unread count", "gmail status", "which email accounts", or "gmail accounts".
argument-hint: [list|check|status]
user-invocable: true
---

# /multi-gmail:gmail — Account Management

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### `list` (default, or no arguments)

Call `multi_gmail_list_accounts`. Display results as a clean list:

```
Account Name — email@example.com — Status: Valid/Expired
```

If no accounts are configured, direct the user to run `/multi-gmail:setup`.

### `check`

Call `multi_gmail_unread_counts`. Display as a summary table:

```
Work (alice@company.com): 12 unread
Personal (alice@gmail.com): 3 unread
```

### `status`

Call `multi_gmail_list_accounts` and show detailed status including whether tokens are valid or expired. For any expired tokens, suggest re-authenticating via the management panel (http://localhost:5000).

### `add <name>` / `remove <name>` / `rename <old> <new>`

These operations require the management panel's OAuth browser flow. Direct the user:

> Account management requires the browser. Open the management panel at http://localhost:5000 to add, remove, or rename accounts.
>
> If the panel isn't running, start it with: `bun run panel` in the plugin directory.
