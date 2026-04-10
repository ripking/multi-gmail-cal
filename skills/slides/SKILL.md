---
name: slides
description: Google Slides actions — get presentations, create presentations, add slides, search. Use when user says "slides", "presentation", "google slides", "slideshow", or "deck".
argument-hint: [get|create|add|search] [args...]
user-invocable: true
---

# /google-workspace:slides — Slides Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically.
- **Multiple accounts** → ask the user which account.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `get <presentation name or ID>`

If given a presentation ID, call `gw_slides_get` directly.

If given a name, first call `gw_slides_search` to find it, then call `gw_slides_get`. Display slide count and content summary per slide.

### `create <title>`

Call `gw_slides_create` with the title. Return the presentation link.

### `add <presentation>`

1. Find the presentation (by ID or name search).
2. Ask for layout preference: BLANK, TITLE, TITLE_AND_BODY, TITLE_ONLY, SECTION_HEADER.
3. Call `gw_slides_add_slide` with the presentation ID and layout.

### `search <query>`

Call `gw_slides_search` to find presentations by name. Display results with name, last modified, and link.
