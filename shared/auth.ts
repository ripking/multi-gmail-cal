import { OAuth2Client } from 'google-auth-library'
import type { MultiGmailConfig, Account } from './types.ts'
import { readConfig, writeConfig } from './store.ts'

const SCOPES = [
  // Gmail
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  // Calendar
  'https://www.googleapis.com/auth/calendar',
  // Docs
  'https://www.googleapis.com/auth/documents',
  // Sheets
  'https://www.googleapis.com/auth/spreadsheets',
  // Slides
  'https://www.googleapis.com/auth/presentations',
  // Drive
  'https://www.googleapis.com/auth/drive',
]

export { SCOPES }

function log(msg: string) {
  process.stderr.write(`multi-gmail: ${msg}\n`)
}

export function createOAuth2Client(config: MultiGmailConfig): OAuth2Client {
  if (!config.oauth) {
    throw new Error('OAuth not configured. Set client_id and client_secret in the management panel.')
  }
  return new OAuth2Client(
    config.oauth.client_id,
    config.oauth.client_secret,
    config.oauth.redirect_uri
  )
}

export async function getAuthenticatedClient(
  config: MultiGmailConfig,
  account: Account
): Promise<OAuth2Client> {
  const client = createOAuth2Client(config)
  client.setCredentials({
    access_token: account.tokens.access_token,
    refresh_token: account.tokens.refresh_token,
    expiry_date: account.tokens.expiry_date,
  })

  // Force refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000
  if (account.tokens.expiry_date <= Date.now() + BUFFER_MS) {
    await forceRefresh(client, account.email)
  }

  return client
}

/**
 * Force-refresh the access token and persist the new credentials.
 */
async function forceRefresh(client: OAuth2Client, email: string): Promise<void> {
  try {
    await client.getAccessToken()
  } catch (err: any) {
    log(`token refresh FAILED for ${email}: ${err.message}`)
    throw err
  }

  const creds = client.credentials
  if (!creds.access_token) {
    log(`token refresh for ${email}: no access_token returned`)
    return
  }

  // Persist refreshed tokens to disk
  const freshConfig = readConfig()
  const acc = freshConfig.accounts.find(a => a.email === email)
  if (!acc) return

  acc.tokens.access_token = creds.access_token
  acc.tokens.expiry_date = creds.expiry_date ?? Date.now() + 3600 * 1000

  // Only update refresh_token if Google rotated it (rare but possible)
  if (creds.refresh_token) {
    log(`token refresh for ${email}: Google rotated refresh token — saving new one`)
    acc.tokens.refresh_token = creds.refresh_token
  }

  writeConfig(freshConfig)
  log(`token refresh OK for ${email}, expires ${new Date(acc.tokens.expiry_date).toISOString()}`)
}

export function isTokenExpired(account: Account): boolean {
  return account.tokens.expiry_date <= Date.now()
}

export function hasRefreshToken(account: Account): boolean {
  return !!account.tokens.refresh_token
}
