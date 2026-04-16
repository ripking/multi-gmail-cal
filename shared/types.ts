export interface OAuthConfig {
  client_id: string
  client_secret: string
  redirect_uri: string
}

export interface AccountTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
}

export interface Account {
  name: string
  email: string
  tokens: AccountTokens
  oauth?: OAuthConfig
}

export interface MultiGmailConfig {
  oauth?: OAuthConfig
  accounts: Account[]
  slack_oauth?: SlackOAuthConfig
  slack_workspaces: SlackWorkspace[]
}

export interface AccountSummary {
  name: string
  email: string
  tokenValid: boolean
  accessTokenExpired: boolean
  hasRefreshToken: boolean
}

// --- Slack ---

export interface SlackOAuthConfig {
  client_id: string
  client_secret: string
  redirect_uri: string
}

export interface SlackWorkspace {
  name: string            // User-defined name (e.g., "Work Slack")
  team_id: string         // Slack workspace ID
  team_name: string       // Slack workspace display name
  bot_token: string       // xoxb-* token
  bot_user_id: string     // Bot's user ID in the workspace
  authed_user_id: string  // User who authorized
  user_token?: string     // xoxp-* token (optional, for search)
}

export interface SlackWorkspaceSummary {
  name: string
  team_id: string
  team_name: string
  hasUserToken: boolean
}
