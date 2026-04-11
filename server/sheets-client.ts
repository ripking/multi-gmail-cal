import { google, type sheets_v4 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export class SheetsClient {
  private sheets: sheets_v4.Sheets
  private auth: OAuth2Client

  constructor(auth: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth })
    this.auth = auth
  }

  async getSpreadsheet(spreadsheetId: string) {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
    })

    return {
      spreadsheetId: res.data.spreadsheetId,
      title: res.data.properties?.title,
      locale: res.data.properties?.locale,
      link: res.data.spreadsheetUrl,
      sheets: (res.data.sheets || []).map(sheet => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index,
        rowCount: sheet.properties?.gridProperties?.rowCount,
        columnCount: sheet.properties?.gridProperties?.columnCount,
      })),
    }
  }

  async readRange(spreadsheetId: string, range: string) {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    })

    return {
      range: res.data.range,
      majorDimension: res.data.majorDimension,
      values: res.data.values || [],
    }
  }

  async writeRange(spreadsheetId: string, range: string, values: string[][]) {
    const res = await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    })

    return {
      updatedRange: res.data.updatedRange,
      updatedRows: res.data.updatedRows,
      updatedColumns: res.data.updatedColumns,
      updatedCells: res.data.updatedCells,
    }
  }

  async createSpreadsheet(title: string) {
    const res = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
    })

    return {
      spreadsheetId: res.data.spreadsheetId,
      title: res.data.properties?.title,
      link: res.data.spreadsheetUrl,
      sheets: (res.data.sheets || []).map(sheet => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
      })),
    }
  }

  async search(query: string, maxResults = 20) {
    // Use Drive API to search for Sheets by name
    const drive = google.drive({ version: 'v3', auth: this.auth })
    const q = `name contains '${query.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`

    const res = await drive.files.list({
      q,
      pageSize: maxResults,
      fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      orderBy: 'modifiedTime desc',
    })

    return (res.data.files || []).map(f => ({
      spreadsheetId: f.id,
      name: f.name,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      owners: (f.owners || []).map(o => o.emailAddress),
      link: f.webViewLink,
    }))
  }
}
