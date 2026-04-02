import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { MultiGmailConfig, Account, AccountSummary } from './types.ts'

export const CONFIG_DIR = join(homedir(), '.claude', 'channels', 'multi-gmail')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export function readConfig(): MultiGmailConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      oauth: parsed.oauth,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { accounts: [] }
    }
    // Corrupt file — back it up and start fresh
    try {
      renameSync(CONFIG_FILE, CONFIG_FILE + '.corrupt.' + Date.now())
    } catch {}
    return { accounts: [] }
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
