import { OAuth2Client } from 'google-auth-library'
import type { MultiGmailConfig, Account } from './types.ts'
import { readConfig, writeConfig } from './store.ts'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
]

export { SCOPES }

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

  // Listen for token refresh events and persist new tokens
  client.on('tokens', (tokens) => {
    persistRefreshedTokens(account.email, tokens)
  })

  // Force refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000
  if (account.tokens.expiry_date <= Date.now() + BUFFER_MS) {
    await forceRefresh(client, account.email)
  }

  return client
}

/**
 * Force-refresh the access token and explicitly persist the new credentials.
 * This is more reliable than relying solely on the 'tokens' event listener.
 */
async function forceRefresh(client: OAuth2Client, email: string): Promise<void> {
  const { token } = await client.getAccessToken()
  // Explicitly persist — don't rely only on the event listener
  const creds = client.credentials
  if (creds.access_token) {
    persistRefreshedTokens(email, {
      access_token: creds.access_token,
      expiry_date: creds.expiry_date ?? undefined,
      refresh_token: creds.refresh_token ?? undefined,
    })
  }
}

function persistRefreshedTokens(
  email: string,
  tokens: { access_token?: string | null; expiry_date?: number | null; refresh_token?: string | null }
): void {
  const freshConfig = readConfig()
  const acc = freshConfig.accounts.find(a => a.email === email)
  if (acc) {
    if (tokens.access_token) acc.tokens.access_token = tokens.access_token
    if (tokens.expiry_date) acc.tokens.expiry_date = tokens.expiry_date
    if (tokens.refresh_token) acc.tokens.refresh_token = tokens.refresh_token
    writeConfig(freshConfig)
  }
}

export function isTokenExpired(account: Account): boolean {
  return account.tokens.expiry_date <= Date.now()
}

export function hasRefreshToken(account: Account): boolean {
  return !!account.tokens.refresh_token
}
