'use strict'

const prisma = require('../config/prisma')

// Persistence adapter for node-oidc-provider, backed by the generic single-table
// `OidcPayload` model. The provider instantiates one adapter per model name
// (Session, Grant, AccessToken, AuthorizationCode, Interaction, …); we use that
// name as the `type` discriminator so every model shares one table.
//
// Contract (see https://github.com/panva/node-oidc-provider — example adapter):
//   - `expiresIn` is in SECONDS; we store an absolute `expiresAt`.
//   - `find*` must treat an expired row as absent (lazy expiry; no TTL job yet).
//   - `consume` marks the row consumed WITHOUT deleting (authorization-code
//     replay detection needs the consumed-but-present record); `find` then
//     surfaces a truthy `consumed` timestamp alongside the payload.
//   - `revokeByGrantId` deletes every row sharing a grantId (cascades token
//     revocation when a Grant is revoked).

function expiresAt(expiresIn) {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
}

function isExpired(row) {
  return row.expiresAt != null && row.expiresAt.getTime() <= Date.now()
}

// Reconstruct the payload the provider stored, re-attaching the `consumed`
// marker it expects (epoch seconds) when the row has been consumed.
function hydrate(row) {
  if (row.consumedAt) {
    return { ...row.payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) }
  }
  return { ...row.payload }
}

class PrismaAdapter {
  constructor(name) {
    this.type = name
  }

  async upsert(id, payload, expiresIn) {
    const data = {
      payload,
      grantId: payload.grantId ?? null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt: expiresAt(expiresIn),
    }
    await prisma.oidcPayload.upsert({
      where: { type_id: { type: this.type, id } },
      update: data,
      create: { id, type: this.type, ...data },
    })
  }

  async find(id) {
    const row = await prisma.oidcPayload.findUnique({
      where: { type_id: { type: this.type, id } },
    })
    if (!row || isExpired(row)) return undefined
    return hydrate(row)
  }

  async findByUid(uid) {
    const row = await prisma.oidcPayload.findUnique({ where: { uid } })
    if (!row || isExpired(row)) return undefined
    return hydrate(row)
  }

  async findByUserCode(userCode) {
    const row = await prisma.oidcPayload.findFirst({ where: { type: this.type, userCode } })
    if (!row || isExpired(row)) return undefined
    return hydrate(row)
  }

  async consume(id) {
    await prisma.oidcPayload.update({
      where: { type_id: { type: this.type, id } },
      data: { consumedAt: new Date() },
    })
  }

  async destroy(id) {
    // Idempotent — the provider may destroy a record that's already gone.
    await prisma.oidcPayload.delete({ where: { type_id: { type: this.type, id } } }).catch(() => {})
  }

  async revokeByGrantId(grantId) {
    await prisma.oidcPayload.deleteMany({ where: { grantId } })
  }
}

module.exports = PrismaAdapter
