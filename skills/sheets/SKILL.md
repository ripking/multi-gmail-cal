---
name: sheets
description: Google Sheets actions — read spreadsheet data, write data, create spreadsheets, search. Use when user says "spreadsheet", "sheets", "google sheets", "read cells", "write data", or "csv".
argument-hint: [read|write|create|search|info] [args...]
user-invocable: true
---

# /google-workspace:sheets — Sheets Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically.
- **Multiple accounts** → ask the user which account.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `read <spreadsheet> <range>`

1. Find the spreadsheet (by ID or name via `gw_sheets_search`).
2. Call `gw_sheets_read` with the range (e.g., "Sheet1!A1:D10").
3. Display data in a readable table format.

### `write <spreadsheet> <range>`

1. Find the spreadsheet.
2. Gather the data to write (as rows of values).
3. Call `gw_sheets_write` with the range and values.
4. Confirm the number of cells updated.

### `create <title>`

Call `gw_sheets_create` with the title. Return the spreadsheet link.

### `search <query>`

Call `gw_sheets_search` to find spreadsheets by name. Display results with name, last modified, and link.

### `info <spreadsheet>`

Call `gw_sheets_get` to show spreadsheet metadata — sheet names, row/column counts, and link.
