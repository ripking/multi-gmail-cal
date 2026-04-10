import { OAuth2Client } from 'google-auth-library'
import type { GoogleWorkspaceConfig, Account } from './types.ts'
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

export function createOAuth2Client(config: GoogleWorkspaceConfig): OAuth2Client {
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
  config: GoogleWorkspaceConfig,
  account: Account
): Promise<OAuth2Client> {
  const client = createOAuth2Client(config)
  client.setCredentials({
    access_token: account.tokens.access_token,
    refresh_token: account.tokens.refresh_token,
    expiry_date: account.tokens.expiry_date,
  })

  // Listen for token refresh events and persist new tokens
  client.on('tokens', (tokens) => {
    const freshConfig = readConfig()
    const acc = freshConfig.accounts.find(a => a.email === account.email)
    if (acc) {
      if (tokens.access_token) acc.tokens.access_token = tokens.access_token
      if (tokens.expiry_date) acc.tokens.expiry_date = tokens.expiry_date
      if (tokens.refresh_token) acc.tokens.refresh_token = tokens.refresh_token
      writeConfig(freshConfig)
    }
  })

  // Force refresh if expired
  if (account.tokens.expiry_date <= Date.now()) {
    await client.getAccessToken()
  }

  return client
}

export function isTokenExpired(account: Account): boolean {
  return account.tokens.expiry_date <= Date.now()
}
