import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { MultiGmailConfig, Account, AccountSummary, SlackWorkspace, SlackWorkspaceSummary } from './types.ts'

export const CONFIG_DIR = join(homedir(), '.claude', 'channels', 'multi-gmail')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export function readConfig(): MultiGmailConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      oauth: parsed.oauth,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      slack_oauth: parsed.slack_oauth,
      slack_workspaces: Array.isArray(parsed.slack_workspaces) ? parsed.slack_workspaces : [],
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { accounts: [], slack_workspaces: [] }
    }
    // Corrupt file — back it up and start fresh
    try {
      renameSync(CONFIG_FILE, CONFIG_FILE + '.corrupt.' + Date.now())
    } catch {}
    return { accounts: [], slack_workspaces: [] }
  }
}

export function writeConfig(config: MultiGmailConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  renameSync(tmp, CONFIG_FILE)
}

export function findAccount(config: MultiGmailConfig, nameOrEmail: string): Account | undefined {
  const lower = nameOrEmail.toLowerCase()
  return config.accounts.find(
    a => a.name.toLowerCase() === lower || a.email.toLowerCase() === lower
  )
}

export function listAccountSummaries(config: MultiGmailConfig): AccountSummary[] {
  return config.accounts.map(a => ({
    name: a.name,
    email: a.email,
    tokenValid: a.tokens.expiry_date > Date.now(),
  }))
}

export function accountNames(config: MultiGmailConfig): string {
  return config.accounts.map(a => `${a.name} (${a.email})`).join(', ')
}

// --- Slack helpers ---

export function findSlackWorkspace(config: MultiGmailConfig, nameOrTeamId: string): SlackWorkspace | undefined {
  const lower = nameOrTeamId.toLowerCase()
  return config.slack_workspaces.find(
    w => w.name.toLowerCase() === lower || w.team_id.toLowerCase() === lower || w.team_name.toLowerCase() === lower
  )
}

export function listSlackWorkspaceSummaries(config: MultiGmailConfig): SlackWorkspaceSummary[] {
  return config.slack_workspaces.map(w => ({
    name: w.name,
    team_id: w.team_id,
    team_name: w.team_name,
    hasUserToken: !!w.user_token,
  }))
}

export function slackWorkspaceNames(config: MultiGmailConfig): string {
  return config.slack_workspaces.map(w => `${w.name} (${w.team_name})`).join(', ')
}
