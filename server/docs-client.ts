import { google, type docs_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export class DocsClient {
  private docs: docs_v1.Docs
  private auth: OAuth2Client

  constructor(auth: OAuth2Client) {
    this.docs = google.docs({ version: 'v1', auth })
    this.auth = auth
  }

  async getDocument(documentId: string) {
    const res = await this.docs.documents.get({ documentId })
    const doc = res.data

    return {
      documentId: doc.documentId,
      title: doc.title,
      revisionId: doc.revisionId,
      body: this.extractText(doc.body),
    }
  }

  async createDocument(title: string) {
    const res = await this.docs.documents.create({
      requestBody: { title },
    })

    return {
      documentId: res.data.documentId,
      title: res.data.title,
      link: `https://docs.google.com/document/d/${res.data.documentId}/edit`,
    }
  }

  async appendText(documentId: string, text: string) {
    // Get current document to find the end index
    const doc = await this.docs.documents.get({ documentId })
    const body = doc.data.body
    const endIndex = body?.content
      ? body.content[body.content.length - 1]?.endIndex || 1
      : 1

    // Insert text at end (before the final newline)
    const insertIndex = Math.max(endIndex - 1, 1)

    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: insertIndex },
              text,
            },
          },
        ],
      },
    })

    return { success: true, documentId, charactersAdded: text.length }
  }

  async search(query: string, maxResults = 20) {
    // Use Drive API to search for Docs by name
    const drive = google.drive({ version: 'v3', auth: this.auth })
    const q = `name contains '${query.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`

    const res = await drive.files.list({
      q,
      pageSize: maxResults,
      fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      orderBy: 'modifiedTime desc',
    })

    return (res.data.files || []).map(f => ({
      documentId: f.id,
      name: f.name,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      owners: (f.owners || []).map(o => o.emailAddress),
      link: f.webViewLink,
    }))
  }

  // --- Private helpers ---

  private extractText(body?: docs_v1.Schema$Body): string {
    if (!body?.content) return ''

    const parts: string[] = []
    for (const element of body.content) {
      if (element.paragraph) {
        const text = this.extractParagraphText(element.paragraph)
        parts.push(text)
      } else if (element.table) {
        parts.push(this.extractTableText(element.table))
      }
    }
    return parts.join('\n')
  }

  private extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
    if (!paragraph.elements) return ''
    return paragraph.elements
      .map(el => el.textRun?.content || '')
      .join('')
  }

  private extractTableText(table: docs_v1.Schema$Table): string {
    if (!table.tableRows) return ''
    const rows = table.tableRows.map(row => {
      const cells = (row.tableCells || []).map(cell => {
        const content = cell.content || []
        return content
          .map(el => el.paragraph ? this.extractParagraphText(el.paragraph) : '')
          .join('')
          .trim()
      })
      return cells.join('\t')
    })
    return rows.join('\n')
  }
}
