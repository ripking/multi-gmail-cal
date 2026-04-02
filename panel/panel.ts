#!/usr/bin/env bun
/**
 * Multi-Gmail Management Panel
 * Localhost web dashboard for account management and OAuth flows.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { readConfig, writeConfig, findAccount } from '../shared/store.ts'
import { getAuthenticatedClient } from '../shared/auth.ts'
import { GmailClient } from '../server/gmail-client.ts'
import { generateAuthUrl, exchangeCode, getEmailFromTokens } from './oauth.ts'

const PORT = 5000
const PUBLIC_DIR = join(import.meta.dir, 'public')
const DEFAULT_REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`

// In-memory pending auth state: name → true
const pendingAuths = new Map<string, boolean>()

function serveStatic(filename: string, contentType: string): Response {
  try {
    const content = readFileSync(join(PUBLIC_DIR, filename), 'utf8')
    return new Response(content, { headers: { 'Content-Type': contentType } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // --- Static files ---
    if (path === '/' || path === '/index.html') return serveStatic('index.html', 'text/html')
    if (path === '/style.css') return serveStatic('style.css', 'text/css')
    if (path === '/app.js') return serveStatic('app.js', 'application/javascript')

    // --- Health check ---
    if (path === '/health') return jsonResponse({ status: 'ok' })

    // --- API: OAuth config ---
    if (path === '/api/oauth-config' && req.method === 'GET') {
      const config = readConfig()
      return jsonResponse({
        configured: !!config.oauth?.client_id,
        redirect_uri: config.oauth?.redirect_uri || DEFAULT_REDIRECT_URI,
      })
    }

    if (path === '/api/oauth-config' && req.method === 'POST') {
      const body = await parseBody(req)
      const config = readConfig()
      config.oauth = {
        client_id: body.client_id as string,
        client_secret: body.client_secret as string,
        redirect_uri: (body.redirect_uri as string) || DEFAULT_REDIRECT_URI,
      }
      writeConfig(config)
      return jsonResponse({ success: true })
    }

    // --- API: Accounts ---
    if (path === '/api/accounts' && req.method === 'GET') {
      const config = readConfig()
      const accounts = config.accounts.map(a => ({
        name: a.name,
        email: a.email,
        tokenValid: a.tokens.expiry_date > Date.now(),
        expiryDate: new Date(a.tokens.expiry_date).toISOString(),
      }))
      return jsonResponse({ accounts })
    }

    if (path === '/api/accounts/add' && req.method === 'POST') {
      const body = await parseBody(req)
      const name = (body.name as string || '').trim()
      if (!name) return jsonResponse({ error: 'Account name is required' }, 400)

      const config = readConfig()
      if (!config.oauth?.client_id) {
        return jsonResponse({ error: 'OAuth not configured. Save your client ID and secret first.' }, 400)
      }
      if (findAccount(config, name)) {
        return jsonResponse({ error: `Account "${name}" already exists` }, 400)
      }

      const state = encodeURIComponent(name)
      const authUrl = generateAuthUrl(config.oauth, state)
      pendingAuths.set(name, true)
      return jsonResponse({ authUrl, name })
    }

    if (path === '/api/accounts/remove' && req.method === 'POST') {
      const body = await parseBody(req)
      const name = (body.name as string || '').trim()
      const config = readConfig()
      const idx = config.accounts.findIndex(
        a => a.name.toLowerCase() === name.toLowerCase()
      )
      if (idx === -1) return jsonResponse({ error: `Account "${name}" not found` }, 404)
      config.accounts.splice(idx, 1)
      writeConfig(config)
      return jsonResponse({ success: true })
    }

    if (path === '/api/accounts/rename' && req.method === 'POST') {
      const body = await parseBody(req)
      const name = (body.name as string || '').trim()
      const newName = (body.newName as string || '').trim()
      if (!newName) return jsonResponse({ error: 'New name is required' }, 400)

      const config = readConfig()
      const account = findAccount(config, name)
      if (!account) return jsonResponse({ error: `Account "${name}" not found` }, 404)
      if (findAccount(config, newName)) return jsonResponse({ error: `Account "${newName}" already exists` }, 400)

      account.name = newName
      writeConfig(config)
      return jsonResponse({ success: true })
    }

    if (path === '/api/accounts/test' && req.method === 'POST') {
      const body = await parseBody(req)
      const name = (body.name as string || '').trim()
      const config = readConfig()
      const account = findAccount(config, name)
      if (!account) return jsonResponse({ error: `Account "${name}" not found` }, 404)

      try {
        const client = await getAuthenticatedClient(config, account)
        const gmail = new GmailClient(client)
        const profile = await gmail.getProfile()
        return jsonResponse({ success: true, profile })
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 500)
      }
    }

    // --- OAuth callback ---
    if (path === '/oauth/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        return new Response(callbackPage(false, `OAuth error: ${error}`), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      if (!code || !state) {
        return new Response(callbackPage(false, 'Missing code or state parameter'), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      const accountName = decodeURIComponent(state)

      try {
        const config = readConfig()
        if (!config.oauth) throw new Error('OAuth not configured')

        const tokens = await exchangeCode(config.oauth, code)
        const email = await getEmailFromTokens(config.oauth, tokens)

        // Check if this email is already connected under another name
        const existing = config.accounts.find(a => a.email === email)
        if (existing) {
          existing.tokens = tokens
          existing.name = accountName
        } else {
          config.accounts.push({ name: accountName, email, tokens })
        }

        writeConfig(config)
        pendingAuths.delete(accountName)

        return new Response(
          callbackPage(true, `Account "${accountName}" connected as ${email}`),
          { headers: { 'Content-Type': 'text/html' } }
        )
      } catch (err: any) {
        pendingAuths.delete(accountName)
        return new Response(
          callbackPage(false, `Failed to complete auth: ${err.message}`),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }
    }

    return new Response('Not found', { status: 404 })
  },
})

function callbackPage(success: boolean, message: string): string {
  const color = success ? '#22c55e' : '#ef4444'
  const icon = success ? '&#10003;' : '&#10007;'
  return `<!DOCTYPE html>
<html><head><title>Multi-Gmail OAuth</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; padding: 3rem; border-radius: 12px; background: #171717; border: 1px solid #262626; max-width: 400px; }
  .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
  .msg { font-size: 1.1rem; margin-bottom: 1.5rem; }
  .hint { color: #737373; font-size: 0.9rem; }
</style></head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <div class="msg">${message}</div>
    <div class="hint">${success ? 'You can close this tab and return to the management panel.' : 'Check your OAuth configuration and try again.'}</div>
  </div>
  <script>setTimeout(() => window.close(), ${success ? 3000 : 10000})</script>
</body></html>`
}

console.log(`Multi-Gmail Management Panel running at http://localhost:${PORT}`)
