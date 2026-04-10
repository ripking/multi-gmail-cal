---
name: drive
description: Google Drive actions — list files, search, create folders, share files, download content. Use when user says "drive", "files", "folders", "share", "download", or "find file".
argument-hint: [list|search|share|folder|download] [args...]
user-invocable: true
---

# /google-workspace:drive — Drive Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically.
- **Multiple accounts** → ask the user which account. Exception: "search all drives" → use `gw_drive_search_all`.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `list` (default, or no arguments)

Call `gw_drive_list` to list files in root. Display as:

```
1. filename.ext — Type — Modified Date
   Shared: Yes/No | Size: ...
```

If the user specifies a folder, use the folder_id parameter.

### `search <query>`

Call `gw_drive_search` with the query. If the user wants a specific type (docs, sheets, etc.), pass the appropriate `mime_type`.

### `folder <name>`

Call `gw_drive_create_folder` to create a new folder. Optionally specify parent.

### `share <file>`

1. Find the file (by searching or using a provided ID).
2. Ask who to share with and what role (reader, writer, commenter).
3. Call `gw_drive_share`.

### `download <file>`

1. Find the file.
2. Call `gw_drive_download` to get the content.
3. Display the content or note if the file is too large.

Note: Google Docs/Sheets/Slides are exported as plain text/CSV. Binary files over 5MB cannot be downloaded.
