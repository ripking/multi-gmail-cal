import { google, type slides_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export class SlidesClient {
  private slides: slides_v1.Slides
  private auth: OAuth2Client

  constructor(auth: OAuth2Client) {
    this.slides = google.slides({ version: 'v1', auth })
    this.auth = auth
  }

  async getPresentation(presentationId: string) {
    const res = await this.slides.presentations.get({ presentationId })
    const pres = res.data

    return {
      presentationId: pres.presentationId,
      title: pres.title,
      link: `https://docs.google.com/presentation/d/${pres.presentationId}/edit`,
      slideCount: pres.slides?.length || 0,
      slides: (pres.slides || []).map((slide, index) => ({
        slideIndex: index,
        objectId: slide.objectId,
        content: this.extractSlideText(slide),
      })),
      layouts: (pres.layouts || []).map(l => ({
        objectId: l.objectId,
        name: l.layoutProperties?.displayName || l.layoutProperties?.name,
      })),
    }
  }

  async createPresentation(title: string) {
    const res = await this.slides.presentations.create({
      requestBody: { title },
    })

    return {
      presentationId: res.data.presentationId,
      title: res.data.title,
      link: `https://docs.google.com/presentation/d/${res.data.presentationId}/edit`,
      slideCount: res.data.slides?.length || 0,
    }
  }

  async addSlide(presentationId: string, layout?: string, insertionIndex?: number) {
    const objectId = `slide_${Date.now()}`

    const request: slides_v1.Schema$Request = {
      createSlide: {
        objectId,
        insertionIndex,
      },
    }

    // Map friendly layout names to predefined layout enum
    if (layout) {
      const layoutMap: Record<string, string> = {
        'BLANK': 'BLANK',
        'TITLE': 'TITLE',
        'TITLE_AND_BODY': 'TITLE_AND_BODY',
        'TITLE_ONLY': 'TITLE_ONLY',
        'SECTION_HEADER': 'SECTION_HEADER',
        'ONE_COLUMN_TEXT': 'ONE_COLUMN_TEXT',
        'MAIN_POINT': 'MAIN_POINT',
      }
      const mappedLayout = layoutMap[layout.toUpperCase()]
      if (mappedLayout) {
        request.createSlide!.slideLayoutReference = {
          predefinedLayout: mappedLayout as slides_v1.Schema$LayoutReference['predefinedLayout'],
        }
      }
    }

    const res = await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [request],
      },
    })

    return {
      slideObjectId: objectId,
      presentationId,
      reply: res.data.replies?.[0]?.createSlide,
    }
  }

  async search(query: string, maxResults = 20) {
    // Use Drive API to search for Slides by name
    const drive = google.drive({ version: 'v3', auth: this.auth })
    const q = `name contains '${query.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.presentation' and trashed = false`

    const res = await drive.files.list({
      q,
      pageSize: maxResults,
      fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      orderBy: 'modifiedTime desc',
    })

    return (res.data.files || []).map(f => ({
      presentationId: f.id,
      name: f.name,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      owners: (f.owners || []).map(o => o.emailAddress),
      link: f.webViewLink,
    }))
  }

  // --- Private helpers ---

  private extractSlideText(slide: slides_v1.Schema$Page): string {
    const parts: string[] = []
    for (const element of slide.pageElements || []) {
      if (element.shape?.text) {
        const text = this.extractTextFromTextElements(element.shape.text)
        if (text.trim()) parts.push(text.trim())
      }
      if (element.table) {
        parts.push(this.extractTableText(element.table))
      }
    }
    return parts.join('\n')
  }

  private extractTextFromTextElements(textContent: slides_v1.Schema$TextContent): string {
    if (!textContent.textElements) return ''
    return textContent.textElements
      .map(el => el.textRun?.content || '')
      .join('')
  }

  private extractTableText(table: slides_v1.Schema$Table): string {
    if (!table.tableRows) return ''
    return table.tableRows
      .map(row => {
        return (row.tableCells || [])
          .map(cell => {
            if (!cell.text?.textElements) return ''
            return cell.text.textElements
              .map(el => el.textRun?.content || '')
              .join('')
              .trim()
          })
          .join('\t')
      })
      .join('\n')
  }
}
