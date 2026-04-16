// --- State ---
let oauthConfigured = false
let slackOAuthConfigured = false
let pollInterval = null
let slackPollInterval = null

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  loadOAuthConfig()
  loadAccounts()
  loadSlackOAuthConfig()
  loadSlackWorkspaces()

  document.getElementById('save-oauth').addEventListener('click', saveOAuthConfig)
  document.getElementById('add-account').addEventListener('click', addAccount)
  document.getElementById('save-slack-oauth').addEventListener('click', saveSlackOAuthConfig)
  document.getElementById('add-workspace').addEventListener('click', addSlackWorkspace)
})

// --- OAuth Config ---
async function loadOAuthConfig() {
  try {
    const res = await fetch('/api/oauth-config')
    const data = await res.json()
    oauthConfigured = data.configured
    updateOAuthStatus()
  } catch (err) {
    console.error('Failed to load OAuth config:', err)
  }
}

function updateOAuthStatus() {
  const badge = document.getElementById('oauth-status')
  if (oauthConfigured) {
    badge.textContent = 'Configured'
    badge.className = 'status-badge status-ok'
  } else {
    badge.textContent = 'Not configured'
    badge.className = 'status-badge status-missing'
  }
}

async function saveOAuthConfig() {
  const clientId = document.getElementById('client-id').value.trim()
  const clientSecret = document.getElementById('client-secret').value.trim()

  if (!clientId || !clientSecret) {
    toast('Both Client ID and Client Secret are required', 'error')
    return
  }

  try {
    const res = await fetch('/api/oauth-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    })
    const data = await res.json()
    if (data.success) {
      oauthConfigured = true
      updateOAuthStatus()
      document.getElementById('client-id').value = ''
      document.getElementById('client-secret').value = ''
      toast('OAuth configuration saved', 'success')
    }
  } catch (err) {
    toast('Failed to save OAuth config: ' + err.message, 'error')
  }
}

// --- Accounts ---
async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts')
    const data = await res.json()
    renderAccounts(data.accounts)
  } catch (err) {
    console.error('Failed to load accounts:', err)
  }
}

function renderAccounts(accounts) {
  const list = document.getElementById('accounts-list')

  if (!accounts || accounts.length === 0) {
    list.innerHTML = '<p class="empty-state">No accounts connected yet. Add one below.</p>'
    return
  }

  list.innerHTML = accounts.map(a => {
    let statusClass, statusText
    if (!a.hasRefreshToken) {
      statusClass = 'status-expired'
      statusText = 'Needs Re-auth'
    } else if (a.accessTokenExpired) {
      statusClass = 'status-ok'
      statusText = 'Active (will auto-refresh)'
    } else {
      statusClass = 'status-ok'
      statusText = 'Active'
    }
    return `
    <div class="account-row">
      <div class="account-info">
        <div class="account-name">${esc(a.name)}</div>
        <div class="account-email">${esc(a.email)}</div>
        <div class="account-hint" style="font-size: 0.8rem; color: #737373;">OAuth Prefix: ${esc(a.clientIdPrefix)}...</div>
      </div>
      <span class="status-badge ${statusClass}">
        ${statusText}
      </span>
      <div class="account-actions">
        <button class="btn btn-secondary btn-small" onclick="testAccount('${esc(a.name)}')">Test</button>
        <button class="btn btn-secondary btn-small" onclick="renameAccount('${esc(a.name)}')">Rename</button>
        <button class="btn btn-danger btn-small" onclick="removeAccount('${esc(a.name)}')">Remove</button>
      </div>
    </div>`
  }).join('')
}

async function addAccount() {
  const nameInput = document.getElementById('new-account-name')
  const name = nameInput.value.trim()
  if (!name) {
    toast('Enter a name for the account', 'error')
    return
  }

  if (!oauthConfigured) {
    toast('Save your OAuth configuration first', 'error')
    return
  }

  try {
    const res = await fetch('/api/accounts/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()

    if (data.error) {
      toast(data.error, 'error')
      return
    }

    // Open auth URL in new tab
    window.open(data.authUrl, '_blank')
    nameInput.value = ''
    toast('Sign in with Google in the new tab...', 'success')

    // Poll for completion
    startPolling()
  } catch (err) {
    toast('Failed to start auth: ' + err.message, 'error')
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval)
  let attempts = 0
  pollInterval = setInterval(async () => {
    attempts++
    await loadAccounts()
    if (attempts >= 30) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }, 2000)
}

async function removeAccount(name) {
  if (!confirm(`Remove account "${name}"? This will delete its tokens.`)) return

  try {
    const res = await fetch('/api/accounts/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (data.error) {
      toast(data.error, 'error')
    } else {
      toast(`Account "${name}" removed`, 'success')
      loadAccounts()
    }
  } catch (err) {
    toast('Failed to remove account: ' + err.message, 'error')
  }
}

async function renameAccount(name) {
  const newName = prompt(`Rename "${name}" to:`)
  if (!newName || newName.trim() === name) return

  try {
    const res = await fetch('/api/accounts/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, newName: newName.trim() }),
    })
    const data = await res.json()
    if (data.error) {
      toast(data.error, 'error')
    } else {
      toast(`Renamed to "${newName.trim()}"`, 'success')
      loadAccounts()
    }
  } catch (err) {
    toast('Failed to rename account: ' + err.message, 'error')
  }
}

async function testAccount(name) {
  toast(`Testing ${name}...`, 'success')
  try {
    const res = await fetch('/api/accounts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (data.success) {
      toast(`${name}: Connected as ${data.profile.email} (${data.profile.messagesTotal} messages)`, 'success')
    } else {
      toast(`${name}: Connection failed — ${data.error}`, 'error')
    }
  } catch (err) {
    toast(`${name}: Test failed — ${err.message}`, 'error')
  }
}

// --- Slack OAuth Config ---
async function loadSlackOAuthConfig() {
  try {
    const res = await fetch('/api/slack-oauth-config')
    const data = await res.json()
    slackOAuthConfigured = data.configured
    updateSlackOAuthStatus()
  } catch (err) {
    console.error('Failed to load Slack OAuth config:', err)
  }
}

function updateSlackOAuthStatus() {
  const badge = document.getElementById('slack-oauth-status')
  if (slackOAuthConfigured) {
    badge.textContent = 'Configured'
    badge.className = 'status-badge status-ok'
  } else {
    badge.textContent = 'Not configured'
    badge.className = 'status-badge status-missing'
  }
}

async function saveSlackOAuthConfig() {
  const clientId = document.getElementById('slack-client-id').value.trim()
  const clientSecret = document.getElementById('slack-client-secret').value.trim()

  if (!clientId || !clientSecret) {
    toast('Both Slack Client ID and Client Secret are required', 'error')
    return
  }

  try {
    const res = await fetch('/api/slack-oauth-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    })
    const data = await res.json()
    if (data.success) {
      slackOAuthConfigured = true
      updateSlackOAuthStatus()
      document.getElementById('slack-client-id').value = ''
      document.getElementById('slack-client-secret').value = ''
      toast('Slack OAuth configuration saved', 'success')
    }
  } catch (err) {
    toast('Failed to save Slack OAuth config: ' + err.message, 'error')
  }
}

// --- Slack Workspaces ---
async function loadSlackWorkspaces() {
  try {
    const res = await fetch('/api/slack-workspaces')
    const data = await res.json()
    renderSlackWorkspaces(data.workspaces)
  } catch (err) {
    console.error('Failed to load Slack workspaces:', err)
  }
}

function renderSlackWorkspaces(workspaces) {
  const list = document.getElementById('slack-workspaces-list')

  if (!workspaces || workspaces.length === 0) {
    list.innerHTML = '<p class="empty-state">No Slack workspaces connected yet. Add one below.</p>'
    return
  }

  list.innerHTML = workspaces.map(w => `
    <div class="account-row">
      <div class="account-info">
        <div class="account-name">${esc(w.name)}</div>
        <div class="account-email">${esc(w.team_name)} ${w.hasUserToken ? '(bot + user token)' : '(bot token only)'}</div>
      </div>
      <span class="status-badge status-ok">Connected</span>
      <div class="account-actions">
        <button class="btn btn-secondary btn-small" onclick="testSlackWorkspace('${esc(w.name)}')">Test</button>
        <button class="btn btn-secondary btn-small" onclick="renameSlackWorkspace('${esc(w.name)}')">Rename</button>
        <button class="btn btn-danger btn-small" onclick="removeSlackWorkspace('${esc(w.name)}')">Remove</button>
      </div>
    </div>
  `).join('')
}

async function addSlackWorkspace() {
  const nameInput = document.getElementById('new-workspace-name')
  const name = nameInput.value.trim()
  if (!name) {
    toast('Enter a name for the workspace', 'error')
    return
  }

  if (!slackOAuthConfigured) {
    toast('Save your Slack OAuth configuration first', 'error')
    return
  }

  try {
    const res = await fetch('/api/slack-workspaces/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()

    if (data.error) {
      toast(data.error, 'error')
      return
    }

    window.open(data.authUrl, '_blank')
    nameInput.value = ''
    toast('Authorize in Slack in the new tab...', 'success')

    startSlackPolling()
  } catch (err) {
    toast('Failed to start Slack auth: ' + err.message, 'error')
  }
}

function startSlackPolling() {
  if (slackPollInterval) clearInterval(slackPollInterval)
  let attempts = 0
  slackPollInterval = setInterval(async () => {
    attempts++
    await loadSlackWorkspaces()
    if (attempts >= 30) {
      clearInterval(slackPollInterval)
      slackPollInterval = null
    }
  }, 2000)
}

async function removeSlackWorkspace(name) {
  if (!confirm(`Remove workspace "${name}"? This will delete its tokens.`)) return

  try {
    const res = await fetch('/api/slack-workspaces/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (data.error) {
      toast(data.error, 'error')
    } else {
      toast(`Workspace "${name}" removed`, 'success')
      loadSlackWorkspaces()
    }
  } catch (err) {
    toast('Failed to remove workspace: ' + err.message, 'error')
  }
}

async function renameSlackWorkspace(name) {
  const newName = prompt(`Rename "${name}" to:`)
  if (!newName || newName.trim() === name) return

  try {
    const res = await fetch('/api/slack-workspaces/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, newName: newName.trim() }),
    })
    const data = await res.json()
    if (data.error) {
      toast(data.error, 'error')
    } else {
      toast(`Renamed to "${newName.trim()}"`, 'success')
      loadSlackWorkspaces()
    }
  } catch (err) {
    toast('Failed to rename workspace: ' + err.message, 'error')
  }
}

async function testSlackWorkspace(name) {
  toast(`Testing ${name}...`, 'success')
  try {
    const res = await fetch('/api/slack-workspaces/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (data.success) {
      toast(`${name}: Connected to ${data.auth.team} as ${data.auth.user}`, 'success')
    } else {
      toast(`${name}: Connection failed — ${data.error}`, 'error')
    }
  } catch (err) {
    toast(`${name}: Test failed — ${err.message}`, 'error')
  }
}

// --- Helpers ---
function esc(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function toast(message, type) {
  // Remove existing toast
  const existing = document.querySelector('.toast')
  if (existing) existing.remove()

  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  document.body.appendChild(el)

  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }, 4000)
}

// --- Collapsible sections ---
function toggleSection(header) {
  const content = header.nextElementSibling
  const chevron = header.querySelector('.chevron')
  if (content.style.display === 'none') {
    content.style.display = 'block'
    chevron.classList.add('open')
  } else {
    content.style.display = 'none'
    chevron.classList.remove('open')
  }
}
