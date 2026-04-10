import type { SlackOAuthConfig, SlackWorkspace } from '../shared/types.ts'

const BOT_SCOPES = [
  'channels:read',
  'channels:history',
  'chat:write',
  'users:read',
  'users:read.email',
  'groups:read',
  'groups:history',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'reactions:read',
  'reactions:write',
  'files:read',
].join(',')

const USER_SCOPES = [
  'search:read',
].join(',')

export function generateSlackAuthUrl(oauth: SlackOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: oauth.client_id,
    scope: BOT_SCOPES,
    user_scope: USER_SCOPES,
    redirect_uri: oauth.redirect_uri,
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

export async function exchangeSlackCode(
  oauth: SlackOAuthConfig,
  code: string
): Promise<SlackWorkspace & { _raw_name: string }> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      code,
      redirect_uri: oauth.redirect_uri,
    }),
  })

  const data = await res.json() as any
  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error}`)
  }

  return {
    name: '',                                     // Filled in by caller
    team_id: data.team.id,
    team_name: data.team.name,
    bot_token: data.access_token,
    bot_user_id: data.bot_user_id,
    authed_user_id: data.authed_user.id,
    user_token: data.authed_user?.access_token,
    _raw_name: data.team.name,                    // For default naming
  }
}
