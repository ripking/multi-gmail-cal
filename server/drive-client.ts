import { google, type drive_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

const FILE_FIELDS = 'id, name, mimeType, size, createdTime, modifiedTime, owners, shared, webViewLink, parents'

// Google Workspace MIME types for export
const EXPORT_MIME_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
}

export class DriveClient {
  private drive: drive_v3.Drive

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: 'v3', auth })
  }

  async listFiles(folderId?: string, maxResults = 20) {
    const q = `'${folderId || 'root'}' in parents and trashed = false`
    const res = await this.drive.files.list({
      q,
      pageSize: maxResults,
      fields: `files(${FILE_FIELDS})`,
      orderBy: 'modifiedTime desc',
    })

    return (res.data.files || []).map(f => this.formatFile(f))
  }

  async search(query: string, mimeType?: string, maxResults = 20) {
    let q = `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`
    if (mimeType) {
      q += ` and mimeType = '${mimeType}'`
    }

    const res = await this.drive.files.list({
      q,
      pageSize: maxResults,
      fields: `files(${FILE_FIELDS})`,
      orderBy: 'modifiedTime desc',
    })

    return (res.data.files || []).map(f => this.formatFile(f))
  }

  async getFile(fileId: string) {
    const res = await this.drive.files.get({
      fileId,
      fields: '*',
    })
    return this.formatFile(res.data)
  }

  async createFolder(name: string, parentId?: string) {
    const requestBody: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }
    if (parentId) {
      requestBody.parents = [parentId]
    }

    const res = await this.drive.files.create({
      requestBody,
      fields: FILE_FIELDS,
    })

    return {
      folderId: res.data.id,
      name: res.data.name,
      webViewLink: res.data.webViewLink,
    }
  }

  async share(fileId: string, email?: string, role = 'reader') {
    if (email) {
      await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'user',
          role,
          emailAddress: email,
        },
      })
      return { success: true, sharedWith: email, role }
    } else {
      // Make public with link
      await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role,
        },
      })
      const file = await this.drive.files.get({
        fileId,
        fields: 'webViewLink',
      })
      return { success: true, publicLink: file.data.webViewLink, role }
    }
  }

  async download(fileId: string) {
    // First get file metadata to determine type
    const meta = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size',
    })

    const mimeType = meta.data.mimeType || ''
    const exportMime = EXPORT_MIME_MAP[mimeType]

    if (exportMime) {
      // Google Workspace file — export it
      const res = await this.drive.files.export({
        fileId,
        mimeType: exportMime,
      }, { responseType: 'text' })
      return {
        name: meta.data.name,
        mimeType: exportMime,
        content: res.data as string,
      }
    }

    // Regular file — try to download as text
    const size = parseInt(meta.data.size || '0', 10)
    if (size > 5 * 1024 * 1024) {
      return {
        name: meta.data.name,
        mimeType,
        error: 'File too large to download (>5MB). Use the Google Drive web interface.',
      }
    }

    const res = await this.drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'text' })

    return {
      name: meta.data.name,
      mimeType,
      content: res.data as string,
    }
  }

  // --- Private helpers ---

  private formatFile(file: drive_v3.Schema$File) {
    return {
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size ? parseInt(file.size, 10) : undefined,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      owners: (file.owners || []).map(o => o.emailAddress),
      shared: file.shared || false,
      webViewLink: file.webViewLink,
      parents: file.parents,
    }
  }
}
