/**
 * Persistent auth event logger.
 * Writes timestamped auth events to a log file for diagnostics.
 * Log file: ~/.claude/channels/multi-gmail/auth.log
 */

import { appendFileSync, mkdirSync, statSync, renameSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from './store.ts'

const LOG_FILE = join(CONFIG_DIR, 'auth.log')
const MAX_LOG_SIZE = 512 * 1024 // 512 KB — rotate after this

function ensureDir() {
  mkdirSync(CONFIG_DIR, { recursive: true })
}

function rotateIfNeeded() {
  try {
    const stats = statSync(LOG_FILE)
    if (stats.size > MAX_LOG_SIZE) {
      renameSync(LOG_FILE, LOG_FILE + '.old')
    }
  } catch {
    // File doesn't exist yet, that's fine
  }
}

export function authLog(event: string, email: string, details?: string) {
  try {
    ensureDir()
    rotateIfNeeded()
    const ts = new Date().toISOString()
    const line = `[${ts}] ${event} | ${email}${details ? ' | ' + details : ''}\n`
    appendFileSync(LOG_FILE, line)
    // Also write to stderr for real-time visibility
    process.stderr.write(`multi-gmail: ${line}`)
  } catch {
    // Never let logging crash the app
  }
}

export { LOG_FILE }
