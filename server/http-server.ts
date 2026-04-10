#!/usr/bin/env bun
/**
 * Google Workspace MCP HTTP Server for Claude Desktop.
 *
 * Runs the same MCP tools as server.ts but over Streamable HTTP transport
 * so Claude Desktop can connect to it as a custom connector.
 *
 * Usage: bun run serve
 * Then add http://localhost:5001/mcp as a custom connector in Claude Desktop.
 */

import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { tools, handleToolCall } from './tools.ts'

const PORT = 5001

// --- Per-session server factory ---

function createServer(): Server {
  const server = new Server(
    { name: 'google-workspace', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params
    const args = (req.params.arguments || {}) as Record<string, unknown>
    return handleToolCall(name, args)
  })

  return server
}

// --- HTTP server with per-session transport ---

const sessions = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; server: Server }>()

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // CORS headers for Claude Desktop
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version',
      'Access-Control-Expose-Headers': 'mcp-session-id',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (url.pathname === '/mcp') {
      // Check for existing session
      const sessionId = req.headers.get('mcp-session-id')

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        const response = await session.transport.handleRequest(req)
        const newHeaders = new Headers(response.headers)
        for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)
        return new Response(response.body, { status: response.status, headers: newHeaders })
      }

      // New session
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server })
          console.log(`Session started: ${id}`)
        },
      })

      const server = createServer()

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
          console.log(`Session ended: ${transport.sessionId}`)
        }
      }

      await server.connect(transport)
      const response = await transport.handleRequest(req)
      const newHeaders = new Headers(response.headers)
      for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)
      return new Response(response.body, { status: response.status, headers: newHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  },
})

console.log(`Google Workspace MCP server running at http://localhost:${PORT}/mcp`)
console.log(`Add this URL as a custom connector in Claude Desktop.`)
