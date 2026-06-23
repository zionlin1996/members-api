'use strict'

const prisma = require('../config/prisma')
const oauthClientService = require('./oauthClient.service')

// Member-facing view of the third-party apps they've authorized ("connected
// apps"). These are derived from the Authorization Server's Grant records, which
// the Prisma adapter stores as OidcPayload rows (type='Grant', id=grantId) with
// the accountId, clientId, and granted openid scope in the JSON payload.
//
// There's no provider API to list grants by account, so we query the adapter's
// table directly (the documented approach for connected-apps management).

function isExpired(row) {
  return row.expiresAt != null && row.expiresAt.getTime() <= Date.now()
}

// All live Grant rows belonging to a member.
async function grantRowsFor(memberId) {
  const rows = await prisma.oidcPayload.findMany({
    where: { type: 'Grant', payload: { path: ['accountId'], equals: memberId } },
  })
  return rows.filter((r) => !isExpired(r))
}

// One entry per client (a client may have several grants over time): union the
// granted scopes and report the most recent authorization time.
async function list(memberId) {
  const rows = await grantRowsFor(memberId)

  const byClient = new Map()
  for (const row of rows) {
    const { clientId, openid, iat } = row.payload
    if (!clientId) continue
    const scopes = openid?.scope ? openid.scope.split(' ') : []
    const existing = byClient.get(clientId)
    if (existing) {
      existing.scopeSet = new Set([...existing.scopeSet, ...scopes])
      existing.authorizedAt = Math.max(existing.authorizedAt ?? 0, iat ?? 0)
    } else {
      byClient.set(clientId, { clientId, scopeSet: new Set(scopes), authorizedAt: iat ?? null })
    }
  }

  // Enrich with client display metadata; a grant for a since-deleted client
  // still shows (so the member can revoke it), falling back to the raw id.
  const connections = await Promise.all(
    [...byClient.values()].map(async ({ clientId, scopeSet, authorizedAt }) => {
      const client = await oauthClientService
        .findProviderClientById(clientId)
        .catch(() => undefined)
      return {
        clientId,
        name: client?.client_name ?? clientId,
        logoUri: client?.logo_uri ?? null,
        scopes: [...scopeSet],
        authorizedAt,
      }
    }),
  )

  connections.sort((a, b) => (b.authorizedAt ?? 0) - (a.authorizedAt ?? 0))
  return connections
}

// Revoke a client's access for a member: drop every grant the member holds for
// that client, plus all tokens/codes/sessions issued under those grants. The
// adapter tags tokens with a `grantId` column (revokeByGrantId territory), but
// the Grant row itself has no grantId, so it's removed by (type, id).
async function revoke(memberId, clientId) {
  const rows = await grantRowsFor(memberId)
  const mine = rows.filter((r) => r.payload.clientId === clientId)
  if (mine.length === 0) {
    const err = new Error('Connection not found')
    err.status = 404
    throw err
  }
  for (const row of mine) {
    await prisma.oidcPayload.deleteMany({ where: { grantId: row.id } }) // tokens/codes/sessions
    await prisma.oidcPayload.deleteMany({ where: { type: 'Grant', id: row.id } }) // the grant itself
  }
}

module.exports = { list, revoke }
