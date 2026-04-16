import { OAuth2Client } from 'google-auth-library'
import type { MultiGmailConfig, Account } from './types.ts'
import { readConfig, writeConfig } from './store.ts'
import { authLog } from './auth-log.ts'

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

  // If account is marked as needing re-auth, fail fast with a clear message
  if (account.needs_reauth) {
    throw Object.assign(
      new Error(`invalid_grant: Refresh token revoked for ${account.email}. Re-authenticate in the management panel.`),
      { code: 401 }
    )
  }

  // Force refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000
  if (account.tokens.expiry_date <= Date.now() + BUFFER_MS) {
    const refreshed = await refreshTokenWithRetry(config, account)
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
 * Refresh with retry and exponential backoff.
 * Retries up to 3 times for transient/network errors.
 * Does NOT retry for permanent errors like invalid_grant.
 */
async function refreshTokenWithRetry(
  config: MultiGmailConfig,
  account: Account,
  maxRetries = 3
): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await refreshTokenDirect(config, account)

      // Success — clear any failure state
      const freshConfig = readConfig()
      const acc = freshConfig.accounts.find(a => a.email === account.email)
      if (acc) {
        acc.last_refresh = new Date().toISOString()
        acc.refresh_failures = 0
        if (acc.needs_reauth) {
          acc.needs_reauth = false
          delete acc.needs_reauth_since
        }
        writeConfig(freshConfig)
      }

      return result
    } catch (err: any) {
      lastError = err

      // Permanent errors — don't retry
      if (err.message?.includes('invalid_grant') ||
          err.message?.includes('invalid_client') ||
          err.message?.includes('unauthorized_client')) {
        authLog('REFRESH_PERMANENT_FAIL', account.email,
          `error=${err.message} | attempt=${attempt + 1} | NOT retrying (permanent error)`)

        // Mark account as needing re-auth for invalid_grant
        if (err.message?.includes('invalid_grant')) {
          markNeedsReauth(account.email, err.message)
        }

        throw err
      }

      // Transient error — retry with backoff
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000) // 1s, 2s, 4s, 8s
        authLog('REFRESH_RETRY', account.email,
          `error=${err.message} | attempt=${attempt + 1}/${maxRetries + 1} | retrying in ${delayMs}ms`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  // All retries exhausted
  authLog('REFRESH_EXHAUSTED', account.email,
    `error=${lastError?.message} | all ${maxRetries + 1} attempts failed`)

  // Track consecutive failures
  const freshConfig = readConfig()
  const acc = freshConfig.accounts.find(a => a.email === account.email)
  if (acc) {
    acc.refresh_failures = (acc.refresh_failures || 0) + 1
    writeConfig(freshConfig)
  }

  throw lastError!
}

/**
 * Mark an account as needing re-authentication.
 * This persists to config so the panel can show it.
 */
function markNeedsReauth(email: string, reason: string) {
  try {
    const config = readConfig()
    const acc = config.accounts.find(a => a.email === email)
    if (acc && !acc.needs_reauth) {
      acc.needs_reauth = true
      acc.needs_reauth_since = new Date().toISOString()
      writeConfig(config)
      authLog('MARKED_REAUTH', email, `reason=${reason}`)
    }
  } catch {
    // Don't let this crash
  }
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
  const { oauth } = config
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
    authLog('REFRESH_NETWORK_ERROR', account.email, `error=${err.message}`)
    throw err
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'unknown', error_description: res.statusText }))
    const msg = `${error.error}${error.error_description ? ': ' + error.error_description : ''}`
    authLog('REFRESH_API_ERROR', account.email, `status=${res.status} | error=${msg}`)
    throw new Error(msg)
  }

  const tokens = await res.json()
  const access_token = tokens.access_token as string
  const expiry_date = tokens.expires_in
    ? Date.now() + tokens.expires_in * 1000
    : Date.now() + 3600 * 1000
  const refresh_token = (tokens.refresh_token as string) || account.tokens.refresh_token

  if (tokens.refresh_token) {
    authLog('TOKEN_ROTATED', account.email, 'Google issued a new refresh token — saving it')
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

  authLog('REFRESH_OK', account.email, `expires=${new Date(expiry_date).toISOString()}`)
  return { access_token, refresh_token, expiry_date }
}

export function isTokenExpired(account: Account): boolean {
  return account.tokens.expiry_date <= Date.now()
}

export function hasRefreshToken(account: Account): boolean {
  return !!account.tokens.refresh_token
}

// --- Proactive Token Keepalive ---

const KEEPALIVE_INTERVAL_MS = 45 * 60 * 1000 // 45 minutes
let keepaliveTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start a background loop that proactively refreshes ALL account tokens.
 * This prevents tokens from expiring due to inactivity — critical for
 * personal Google accounts on unverified apps where Google may revoke
 * idle refresh tokens.
 *
 * The loop runs every 45 minutes and refreshes any token that will
 * expire within the next 50 minutes.
 */
export function startTokenKeepalive() {
  if (keepaliveTimer) return // Already running

  authLog('KEEPALIVE_START', '*', `interval=${KEEPALIVE_INTERVAL_MS / 60000}min`)

  // Run immediately on start, then on interval
  refreshAllAccounts()
  keepaliveTimer = setInterval(refreshAllAccounts, KEEPALIVE_INTERVAL_MS)

  // Don't prevent process exit
  if (keepaliveTimer && typeof keepaliveTimer === 'object' && 'unref' in keepaliveTimer) {
    keepaliveTimer.unref()
  }
}

export function stopTokenKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
    authLog('KEEPALIVE_STOP', '*', 'stopped')
  }
}

/**
 * Proactively refresh tokens for all accounts.
 * Skips accounts that are marked as needing re-auth.
 * Refreshes any token expiring within 50 minutes.
 */
async function refreshAllAccounts() {
  try {
    const config = readConfig()
    if (!config.oauth || config.accounts.length === 0) return

    const PROACTIVE_BUFFER_MS = 50 * 60 * 1000 // 50 minutes

    for (const account of config.accounts) {
      if (account.needs_reauth) {
        authLog('KEEPALIVE_SKIP', account.email, 'needs_reauth=true')
        continue
      }

      if (!account.tokens.refresh_token) {
        authLog('KEEPALIVE_SKIP', account.email, 'no refresh token')
        continue
      }

      if (account.tokens.expiry_date > Date.now() + PROACTIVE_BUFFER_MS) {
        // Token is still fresh, no need to refresh
        continue
      }

      try {
        // Re-read config to get latest state for this account
        const freshConfig = readConfig()
        const freshAccount = freshConfig.accounts.find(a => a.email === account.email)
        if (!freshAccount || freshAccount.needs_reauth) continue

        await refreshTokenWithRetry(freshConfig, freshAccount, 2)
        authLog('KEEPALIVE_OK', account.email, 'proactive refresh succeeded')
      } catch (err: any) {
        authLog('KEEPALIVE_FAIL', account.email, `error=${err.message}`)
        // Don't rethrow — continue with other accounts
      }
    }
  } catch (err: any) {
    authLog('KEEPALIVE_ERROR', '*', `error=${err.message}`)
  }
}

/**
 * Check the health of all accounts. Returns detailed status for each.
 */
export async function checkAllAccountHealth(): Promise<Array<{
  name: string
  email: string
  status: 'healthy' | 'expiring_soon' | 'expired' | 'needs_reauth' | 'no_refresh_token' | 'error'
  details: string
  accessTokenExpiry: string
  lastRefresh: string | null
  refreshFailures: number
  needsReauth: boolean
}>> {
  const config = readConfig()
  const results = []

  for (const account of config.accounts) {
    const entry: any = {
      name: account.name,
      email: account.email,
      accessTokenExpiry: new Date(account.tokens.expiry_date).toISOString(),
      lastRefresh: account.last_refresh || null,
      refreshFailures: account.refresh_failures || 0,
      needsReauth: account.needs_reauth || false,
    }

    if (account.needs_reauth) {
      entry.status = 'needs_reauth'
      entry.details = `Refresh token revoked since ${account.needs_reauth_since || 'unknown'}. Re-authenticate in the management panel.`
    } else if (!account.tokens.refresh_token) {
      entry.status = 'no_refresh_token'
      entry.details = 'No refresh token stored. Re-authenticate in the management panel.'
    } else if (account.tokens.expiry_date <= Date.now()) {
      // Token expired but has refresh token — try refreshing
      try {
        const freshConfig = readConfig()
        const freshAccount = freshConfig.accounts.find(a => a.email === account.email)
        if (freshAccount) {
          await refreshTokenWithRetry(freshConfig, freshAccount, 1)
          entry.status = 'healthy'
          entry.details = 'Access token was expired but successfully refreshed.'
          // Update expiry from fresh config
          const updatedConfig = readConfig()
          const updatedAccount = updatedConfig.accounts.find(a => a.email === account.email)
          if (updatedAccount) {
            entry.accessTokenExpiry = new Date(updatedAccount.tokens.expiry_date).toISOString()
            entry.lastRefresh = updatedAccount.last_refresh || null
          }
        }
      } catch (err: any) {
        entry.status = 'error'
        entry.details = `Refresh failed: ${err.message}`
      }
    } else {
      const remainingMs = account.tokens.expiry_date - Date.now()
      const remainingMin = Math.round(remainingMs / 60000)
      if (remainingMin < 10) {
        entry.status = 'expiring_soon'
        entry.details = `Access token expires in ${remainingMin} minutes.`
      } else {
        entry.status = 'healthy'
        entry.details = `Access token valid for ${remainingMin} minutes.`
      }
    }

    results.push(entry)
  }

  return results
}
