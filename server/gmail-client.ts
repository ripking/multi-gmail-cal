import { google, type gmail_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export class GmailClient {
  private gmail: gmail_v1.Gmail

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  async getProfile() {
    const res = await this.gmail.users.getProfile({ userId: 'me' })
    return {
      email: res.data.emailAddress,
      messagesTotal: res.data.messagesTotal,
      threadsTotal: res.data.threadsTotal,
      historyId: res.data.historyId,
    }
  }

  async search(query: string, maxResults = 10) {
    const list = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    })

    if (!list.data.messages?.length) return []

    const messages = await Promise.all(
      list.data.messages.map(m => this.getMessageSummary(m.id!))
    )
    return messages
  }

  async readMessage(messageId: string) {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    })
    return this.parseMessage(res.data)
  }

  async readThread(threadId: string) {
    const res = await this.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    })
    return (res.data.messages || []).map(m => this.parseMessage(m))
  }

  async createDraft(params: {
    to: string
    subject: string
    body: string
    cc?: string
    bcc?: string
    inReplyTo?: string
  }) {
    let raw: string
    let threadId: string | undefined

    if (params.inReplyTo) {
      const original = await this.gmail.users.messages.get({
        userId: 'me',
        id: params.inReplyTo,
        format: 'metadata',
        metadataHeaders: ['Message-ID'],
      })
      const messageIdHeader = this.getHeader(original.data.payload?.headers, 'Message-ID')
      raw = this.buildRawMessage({ ...params, messageIdHeader })
      threadId = original.data.threadId!
    } else {
      raw = this.buildRawMessage(params)
    }

    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw, threadId },
      },
    })
    return { draftId: res.data.id }
  }

  async send(params: {
    to: string
    subject: string
    body: string
    cc?: string
    bcc?: string
    inReplyTo?: string
  }) {
    let raw: string
    let threadId: string | undefined

    if (params.inReplyTo) {
      const original = await this.gmail.users.messages.get({
        userId: 'me',
        id: params.inReplyTo,
        format: 'metadata',
        metadataHeaders: ['Message-ID'],
      })
      const messageIdHeader = this.getHeader(original.data.payload?.headers, 'Message-ID')
      raw = this.buildRawMessage({ ...params, messageIdHeader })
      threadId = original.data.threadId!
    } else {
      raw = this.buildRawMessage(params)
    }

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    })
    return { messageId: res.data.id }
  }

  async listDrafts(maxResults = 10) {
    const list = await this.gmail.users.drafts.list({
      userId: 'me',
      maxResults,
    })

    if (!list.data.drafts?.length) return []

    const drafts = await Promise.all(
      list.data.drafts.map(async d => {
        const draft = await this.gmail.users.drafts.get({
          userId: 'me',
          id: d.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'To', 'Date'],
        })
        const headers = draft.data.message?.payload?.headers
        return {
          draftId: d.id,
          subject: this.getHeader(headers, 'Subject') || '(no subject)',
          to: this.getHeader(headers, 'To') || '',
          snippet: draft.data.message?.snippet || '',
        }
      })
    )
    return drafts
  }

  async listLabels() {
    const res = await this.gmail.users.labels.list({ userId: 'me' })
    return (res.data.labels || []).map(l => ({
      id: l.id,
      name: l.name,
      type: l.type,
    }))
  }

  async modifyLabels(messageId: string, addLabelIds?: string[], removeLabelIds?: string[]) {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: addLabelIds || [],
        removeLabelIds: removeLabelIds || [],
      },
    })
    return { success: true }
  }

  async getUnreadCount(): Promise<number> {
    const res = await this.gmail.users.labels.get({
      userId: 'me',
      id: 'INBOX',
    })
    return res.data.messagesUnread || 0
  }

  // --- Private helpers ---

  private async getMessageSummary(messageId: string) {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date', 'To'],
    })
    const headers = res.data.payload?.headers
    return {
      messageId: res.data.id,
      threadId: res.data.threadId,
      subject: this.getHeader(headers, 'Subject') || '(no subject)',
      from: this.getHeader(headers, 'From') || '',
      to: this.getHeader(headers, 'To') || '',
      date: this.getHeader(headers, 'Date') || '',
      snippet: res.data.snippet || '',
    }
  }

  private parseMessage(msg: gmail_v1.Schema$Message) {
    const headers = msg.payload?.headers
    const body = this.extractBody(msg.payload)
    const attachments = this.extractAttachments(msg.payload)

    return {
      messageId: msg.id,
      threadId: msg.threadId,
      labelIds: msg.labelIds || [],
      subject: this.getHeader(headers, 'Subject') || '(no subject)',
      from: this.getHeader(headers, 'From') || '',
      to: this.getHeader(headers, 'To') || '',
      cc: this.getHeader(headers, 'Cc') || '',
      date: this.getHeader(headers, 'Date') || '',
      body,
      attachments,
    }
  }

  private extractBody(payload?: gmail_v1.Schema$MessagePart): string {
    if (!payload) return ''

    // Simple body (no parts)
    if (payload.body?.data && payload.mimeType === 'text/plain') {
      return this.decodeBase64Url(payload.body.data)
    }

    // Multipart — look for text/plain first, then text/html
    if (payload.parts) {
      const plainPart = payload.parts.find(p => p.mimeType === 'text/plain')
      if (plainPart?.body?.data) {
        return this.decodeBase64Url(plainPart.body.data)
      }

      const htmlPart = payload.parts.find(p => p.mimeType === 'text/html')
      if (htmlPart?.body?.data) {
        return this.stripHtml(this.decodeBase64Url(htmlPart.body.data))
      }

      // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
      for (const part of payload.parts) {
        if (part.parts) {
          const nested = this.extractBody(part)
          if (nested) return nested
        }
      }
    }

    // Fallback: html body at top level
    if (payload.body?.data && payload.mimeType === 'text/html') {
      return this.stripHtml(this.decodeBase64Url(payload.body.data))
    }

    return ''
  }

  private extractAttachments(payload?: gmail_v1.Schema$MessagePart): Array<{
    filename: string
    mimeType: string
    size: number
  }> {
    const attachments: Array<{ filename: string; mimeType: string; size: number }> = []
    if (!payload?.parts) return attachments

    for (const part of payload.parts) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body?.size || 0,
        })
      }
      // Recurse into nested parts
      if (part.parts) {
        attachments.push(...this.extractAttachments(part))
      }
    }
    return attachments
  }

  private getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
    return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined
  }

  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(base64, 'base64').toString('utf8')
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private buildRawMessage(params: {
    to: string
    subject: string
    body: string
    cc?: string
    bcc?: string
    messageIdHeader?: string
  }): string {
    const lines: string[] = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
    ]
    if (params.cc) lines.push(`Cc: ${params.cc}`)
    if (params.bcc) lines.push(`Bcc: ${params.bcc}`)
    if (params.messageIdHeader) {
      lines.push(`In-Reply-To: ${params.messageIdHeader}`)
      lines.push(`References: ${params.messageIdHeader}`)
    }
    lines.push('', params.body)

    const raw = lines.join('\r\n')
    return Buffer.from(raw).toString('base64url')
  }
}
