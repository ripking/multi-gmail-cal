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
}

export interface GoogleWorkspaceConfig {
  oauth?: OAuthConfig
  accounts: Account[]
}

/** @deprecated Use GoogleWorkspaceConfig */
export type MultiGmailConfig = GoogleWorkspaceConfig

export interface AccountSummary {
  name: string
  email: string
  tokenValid: boolean
}
