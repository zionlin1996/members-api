'use strict'

// In-memory adapter for node-oidc-provider — TEST ONLY (OIDC_ADAPTER=memory).
// Implements the same contract as the Prisma adapter so integration tests can
// drive the real provider end-to-end (/authorize → interaction → /token →
// /userinfo) without a database. State lives in module-level maps shared across
// all adapter instances, keyed by `${type}:${id}`.

const store = new Map() // `${type}:${id}` -> { payload, grantId, userCode, uid, expiresAt, consumedAt }

function key(type, id) {
  return `${type}:${id}`
}

function isExpired(row) {
  return row.expiresAt != null && row.expiresAt <= Date.now()
}

function hydrate(row) {
  if (row.consumedAt) return { ...row.payload, consumed: Math.floor(row.consumedAt / 1000) }
  return { ...row.payload }
}

class MemoryAdapter {
  constructor(name) {
    this.type = name
  }

  async upsert(id, payload, expiresIn) {
    store.set(key(this.type, id), {
      payload,
      grantId: payload.grantId,
      userCode: payload.userCode,
      uid: payload.uid,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
      consumedAt: null,
    })
  }

  async find(id) {
    const row = store.get(key(this.type, id))
    if (!row || isExpired(row)) return undefined
    return hydrate(row)
  }

  async findByUid(uid) {
    for (const row of store.values()) {
      if (row.uid === uid) return isExpired(row) ? undefined : hydrate(row)
    }
    return undefined
  }

  async findByUserCode(userCode) {
    for (const [k, row] of store.entries()) {
      if (k.startsWith(`${this.type}:`) && row.userCode === userCode) {
        return isExpired(row) ? undefined : hydrate(row)
      }
    }
    return undefined
  }

  async consume(id) {
    const row = store.get(key(this.type, id))
    if (row) row.consumedAt = Date.now()
  }

  async destroy(id) {
    store.delete(key(this.type, id))
  }

  async revokeByGrantId(grantId) {
    for (const [k, row] of store.entries()) {
      if (row.grantId === grantId) store.delete(k)
    }
  }
}

// Exposed so tests can reset state between cases.
MemoryAdapter.clear = () => store.clear()

module.exports = MemoryAdapter
