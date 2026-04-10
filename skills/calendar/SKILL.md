---
name: calendar
description: Google Calendar actions — list events, create events, update events, check schedules. Use when user says "calendar", "events", "schedule", "meeting", "appointment", "free time", or "what's on my calendar".
argument-hint: [list|create|update|delete] [args...]
user-invocable: true
---

# /google-workspace:calendar — Calendar Actions

Arguments passed: `$ARGUMENTS`

---

## Account resolution

Before any action, call `gw_list_accounts` to see what's connected.

- **One account** → use it automatically.
- **Multiple accounts** → ask the user which account. Exception: if the user said "all accounts", use `gw_calendar_list_events_all`.
- **No accounts** → direct to `/google-workspace:setup`.

## Dispatch on arguments

### `list` (default, or no arguments)

Call `gw_calendar_list_events` with appropriate time range. Display as:

```
1. Event Title — Start Time - End Time
   Location: ... | Attendees: ...
```

Time ranges:
- "today" → today 00:00 to 23:59
- "this week" → Monday to Sunday
- "tomorrow" → tomorrow 00:00 to 23:59
- Default → now to 7 days from now

### `create`

1. Resolve which account.
2. Gather: title (summary), start time, end time, description, location, attendees.
3. Call `gw_calendar_create_event`.
4. Confirm with the event link.

### `update <event description or ID>`

1. If given an event ID, call `gw_calendar_get_event` to fetch it.
2. If given a description, search for it by listing events and matching.
3. Confirm which event to update, then gather changes.
4. Call `gw_calendar_update_event` with only the changed fields.

### `delete <event description or ID>`

1. Find the event (by ID or by listing and matching).
2. Confirm with the user before deleting.
3. Call `gw_calendar_delete_event`.

### `calendars`

Call `gw_calendar_list_calendars` to show all calendars (primary, shared, subscribed).
