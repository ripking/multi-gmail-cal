import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import type { OAuthConfig, AccountTokens } from '../shared/types.ts'
import { SCOPES } from '../shared/auth.ts'

export function generateAuthUrl(oauth: OAuthConfig, state: string): string {
  const client = new OAuth2Client(oauth.client_id, oauth.client_secret, oauth.redirect_uri)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  })
}

export async function exchangeCode(oauth: OAuthConfig, code: string): Promise<AccountTokens> {
  const client = new OAuth2Client(oauth.client_id, oauth.client_secret, oauth.redirect_uri)
  const { tokens } = await client.getToken(code)
  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
  }
}

export async function getEmailFromTokens(oauth: OAuthConfig, tokens: AccountTokens): Promise<string> {
  const client = new OAuth2Client(oauth.client_id, oauth.client_secret, oauth.redirect_uri)
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  })
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return profile.data.emailAddress!
}
