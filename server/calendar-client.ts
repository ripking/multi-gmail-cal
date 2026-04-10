import { google, type calendar_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export class CalendarClient {
  private calendar: calendar_v3.Calendar

  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth })
  }

  async listCalendars() {
    const res = await this.calendar.calendarList.list()
    return (res.data.items || []).map(cal => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description || '',
      primary: cal.primary || false,
      accessRole: cal.accessRole,
      backgroundColor: cal.backgroundColor,
      timeZone: cal.timeZone,
    }))
  }

  async listEvents(
    calendarId?: string,
    timeMin?: string,
    timeMax?: string,
    maxResults = 20
  ) {
    const now = new Date()
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const res = await this.calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: timeMin || now.toISOString(),
      timeMax: timeMax || weekFromNow.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    })

    return (res.data.items || []).map(event => this.formatEvent(event))
  }

  async getEvent(eventId: string, calendarId?: string) {
    const res = await this.calendar.events.get({
      calendarId: calendarId || 'primary',
      eventId,
    })
    return this.formatEvent(res.data)
  }

  async createEvent(params: {
    calendarId?: string
    summary: string
    start: string
    end: string
    description?: string
    location?: string
    attendees?: string[]
  }) {
    const event: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: this.parseDateTime(params.start),
      end: this.parseDateTime(params.end),
    }

    if (params.attendees?.length) {
      event.attendees = params.attendees.map(email => ({ email }))
    }

    const res = await this.calendar.events.insert({
      calendarId: params.calendarId || 'primary',
      requestBody: event,
    })

    return {
      eventId: res.data.id,
      htmlLink: res.data.htmlLink,
      summary: res.data.summary,
      start: res.data.start,
      end: res.data.end,
    }
  }

  async updateEvent(params: {
    calendarId?: string
    eventId: string
    summary?: string
    start?: string
    end?: string
    description?: string
    location?: string
    attendees?: string[]
  }) {
    const patch: calendar_v3.Schema$Event = {}

    if (params.summary !== undefined) patch.summary = params.summary
    if (params.description !== undefined) patch.description = params.description
    if (params.location !== undefined) patch.location = params.location
    if (params.start) patch.start = this.parseDateTime(params.start)
    if (params.end) patch.end = this.parseDateTime(params.end)
    if (params.attendees) {
      patch.attendees = params.attendees.map(email => ({ email }))
    }

    const res = await this.calendar.events.patch({
      calendarId: params.calendarId || 'primary',
      eventId: params.eventId,
      requestBody: patch,
    })

    return this.formatEvent(res.data)
  }

  async deleteEvent(eventId: string, calendarId?: string) {
    await this.calendar.events.delete({
      calendarId: calendarId || 'primary',
      eventId,
    })
    return { success: true, deletedEventId: eventId }
  }

  // --- Private helpers ---

  private formatEvent(event: calendar_v3.Schema$Event) {
    return {
      eventId: event.id,
      summary: event.summary || '(no title)',
      description: event.description || '',
      location: event.location || '',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      status: event.status,
      htmlLink: event.htmlLink,
      creator: event.creator?.email || '',
      organizer: event.organizer?.email || '',
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: a.organizer || false,
        self: a.self || false,
      })),
      hangoutLink: event.hangoutLink || '',
      conferenceData: event.conferenceData?.entryPoints?.map(ep => ({
        type: ep.entryPointType,
        uri: ep.uri,
      })) || [],
    }
  }

  private parseDateTime(dt: string): calendar_v3.Schema$EventDateTime {
    // If it looks like a date-only string (YYYY-MM-DD), use date field
    if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      return { date: dt }
    }
    // Otherwise treat as dateTime
    return { dateTime: dt }
  }
}
