---
name: docs
description: Google Docs actions — get document content, create docs, append text, search for docs. Use when user says "doc", "document", "google doc", "write document", or "find document".
argument-hint: [get|create|append|search] [args...]
user-invocable: true
---

# /google-workspace:docs — Docs Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically.
- **Multiple accounts** → ask the user which account.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `get <document name or ID>`

If given a document ID, call `gw_docs_get` directly.

If given a name, first call `gw_docs_search` to find the document, then call `gw_docs_get` with the matched document ID. Display the document content clearly.

### `create <title>`

Call `gw_docs_create` with the title. Return the document link.

### `append <document> <text>`

1. Find the document (by ID or name search).
2. Call `gw_docs_append` with the text to add.
3. Confirm success.

### `search <query>`

Call `gw_docs_search` to find documents by name. Display results with document name, last modified date, and link.
