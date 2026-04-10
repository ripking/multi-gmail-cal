import { WebClient } from '@slack/web-api'

export class SlackClient {
  private bot: WebClient
  private user: WebClient | null

  constructor(botToken: string, userToken?: string) {
    this.bot = new WebClient(botToken)
    this.user = userToken ? new WebClient(userToken) : null
  }

  async testAuth() {
    const res = await this.bot.auth.test()
    return {
      ok: res.ok,
      team: res.team,
      team_id: res.team_id,
      user: res.user,
      user_id: res.user_id,
      bot_id: res.bot_id,
    }
  }

  async listChannels(types: string[] = ['public_channel', 'private_channel'], limit = 200) {
    const res = await this.bot.conversations.list({
      types: types.join(','),
      limit,
      exclude_archived: true,
    })

    return (res.channels || []).map(ch => ({
      id: ch.id,
      name: ch.name,
      is_channel: ch.is_channel,
      is_group: ch.is_group,
      is_im: ch.is_im,
      is_private: ch.is_private,
      is_member: ch.is_member,
      topic: ch.topic?.value || '',
      purpose: ch.purpose?.value || '',
      num_members: ch.num_members,
    }))
  }

  async getChannelHistory(channelId: string, limit = 20) {
    const res = await this.bot.conversations.history({
      channel: channelId,
      limit,
    })

    return (res.messages || []).map(msg => ({
      ts: msg.ts,
      user: msg.user,
      text: msg.text,
      thread_ts: msg.thread_ts,
      reply_count: msg.reply_count,
      reactions: msg.reactions?.map(r => ({
        name: r.name,
        count: r.count,
      })),
      files: msg.files?.map(f => ({
        name: f.name,
        mimetype: f.mimetype,
        size: f.size,
      })),
    }))
  }

  async postMessage(channelId: string, text: string) {
    const res = await this.bot.chat.postMessage({
      channel: channelId,
      text,
    })
    return {
      ok: res.ok,
      channel: res.channel,
      ts: res.ts,
    }
  }

  async replyToThread(channelId: string, threadTs: string, text: string) {
    const res = await this.bot.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
    })
    return {
      ok: res.ok,
      channel: res.channel,
      ts: res.ts,
      thread_ts: threadTs,
    }
  }

  async searchMessages(query: string, count = 20) {
    if (!this.user) {
      throw new Error('Search requires a user token. Re-authorize this workspace with user scopes in the management panel.')
    }
    const res = await this.user.search.messages({
      query,
      count,
      sort: 'timestamp',
      sort_dir: 'desc',
    })

    const matches = res.messages?.matches || []
    return matches.map((m: any) => ({
      ts: m.ts,
      channel: { id: m.channel?.id, name: m.channel?.name },
      user: m.user || m.username,
      text: m.text,
      permalink: m.permalink,
    }))
  }

  async listUsers(limit = 200) {
    const res = await this.bot.users.list({ limit })
    return (res.members || [])
      .filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')
      .map(u => ({
        id: u.id,
        name: u.name,
        real_name: u.real_name || u.profile?.real_name,
        display_name: u.profile?.display_name,
        email: u.profile?.email,
        is_admin: u.is_admin,
        is_owner: u.is_owner,
        tz: u.tz,
        status_text: u.profile?.status_text,
        status_emoji: u.profile?.status_emoji,
      }))
  }

  async getUserInfo(userId: string) {
    const res = await this.bot.users.info({ user: userId })
    const u = res.user!
    return {
      id: u.id,
      name: u.name,
      real_name: u.real_name || u.profile?.real_name,
      display_name: u.profile?.display_name,
      email: u.profile?.email,
      title: u.profile?.title,
      phone: u.profile?.phone,
      is_admin: u.is_admin,
      is_owner: u.is_owner,
      is_bot: u.is_bot,
      tz: u.tz,
      tz_label: u.tz_label,
      status_text: u.profile?.status_text,
      status_emoji: u.profile?.status_emoji,
    }
  }

  async addReaction(channelId: string, timestamp: string, emoji: string) {
    const res = await this.bot.reactions.add({
      channel: channelId,
      timestamp,
      name: emoji,
    })
    return { ok: res.ok }
  }
}
