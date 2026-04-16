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

export function createOAuth2Client(config: MultiGmailConfig, account?: Account): OAuth2Client {
  const oauth = account?.oauth || config.oauth
  if (!oauth) {
    throw new Error('OAuth not configured. Set client_id and client_secret in the management panel.')
  }
  return new OAuth2Client(
    oauth.client_id,
    oauth.client_secret,
    oauth.redirect_uri
  )
}

export async function getAuthenticatedClient(
  config: MultiGmailConfig,
  account: Account
): Promise<OAuth2Client> {
  const client = createOAuth2Client(config, account)

  // Force refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000
  if (account.tokens.expiry_date <= Date.now() + BUFFER_MS) {
    const refreshed = await refreshTokenDirect(config, account)
    client.setCredentials({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expiry_date: refreshed.expiry_date,
    })
  } else {
    client.setCredentials({
      access_token: account.tokens.access_token,
      refresh_token: account.tokens.refresh_token,
      expiry_date: account.tokens.expiry_date,
    })
  }

  return client
}

/**
 * Refresh the access token by calling Google's token endpoint directly.
 * Bypasses google-auth-library's refresh which sends extra parameters
 * (like redirect_uri) that can cause unauthorized_client errors.
 */
async function refreshTokenDirect(
  config: MultiGmailConfig,
  account: Account
): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  const oauth = account.oauth || config.oauth
  if (!oauth) throw new Error('OAuth not configured')

  const body = new URLSearchParams({
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    refresh_token: account.tokens.refresh_token,
    grant_type: 'refresh_token',
  })

  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err: any) {
    log(`token refresh FAILED for ${account.email}: network error: ${err.message}`)
    throw err
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'unknown', error_description: res.statusText }))
    const msg = `${error.error}${error.error_description ? ': ' + error.error_description : ''}`
    log(`token refresh FAILED for ${account.email}: ${msg}`)
    throw new Error(msg)
  }

  const tokens = await res.json()
  const access_token = tokens.access_token as string
  const expiry_date = tokens.expires_in
    ? Date.now() + tokens.expires_in * 1000
    : Date.now() + 3600 * 1000
  const refresh_token = (tokens.refresh_token as string) || account.tokens.refresh_token

  if (tokens.refresh_token) {
    log(`token refresh for ${account.email}: Google rotated refresh token — saving new one`)
  }

  // Persist refreshed tokens to disk
  const freshConfig = readConfig()
  const acc = freshConfig.accounts.find(a => a.email === account.email)
  if (acc) {
    acc.tokens.access_token = access_token
    acc.tokens.expiry_date = expiry_date
    acc.tokens.refresh_token = refresh_token
    writeConfig(freshConfig)
  }

  log(`token refresh OK for ${account.email}, expires ${new Date(expiry_date).toISOString()}`)
  return { access_token, refresh_token, expiry_date }
}

export function isTokenExpired(account: Account): boolean {
  return account.tokens.expiry_date <= Date.now()
}

export function hasRefreshToken(account: Account): boolean {
  return !!account.tokens.refresh_token
}
