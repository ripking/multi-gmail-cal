// --- State ---
let oauthConfigured = false
let pollInterval = null

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  loadOAuthConfig()
  loadAccounts()

  document.getElementById('save-oauth').addEventListener('click', saveOAuthConfig)
  document.getElementById('add-account').addEventListener('click', addAccount)
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

  list.innerHTML = accounts.map(a => `
    <div class="account-row">
      <div class="account-info">
        <div class="account-name">${esc(a.name)}</div>
        <div class="account-email">${esc(a.email)}</div>
      </div>
      <span class="status-badge ${a.tokenValid ? 'status-ok' : 'status-expired'}">
        ${a.tokenValid ? 'Valid' : 'Expired'}
      </span>
      <div class="account-actions">
        <button class="btn btn-secondary btn-small" onclick="testAccount('${esc(a.name)}')">Test</button>
        <button class="btn btn-secondary btn-small" onclick="renameAccount('${esc(a.name)}')">Rename</button>
        <button class="btn btn-danger btn-small" onclick="removeAccount('${esc(a.name)}')">Remove</button>
      </div>
    </div>
  `).join('')
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
