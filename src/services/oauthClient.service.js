'use strict'

const crypto = require('crypto')
const prisma = require('../config/prisma')

// Registry of third-party OAuth/OIDC clients for the Authorization Server,
// managed by admins via /admin/oauth-clients. Phase 3 serves PUBLIC clients
// only: PKCE is mandatory (see oidc/configuration.js) and there is no client
// secret, which is the OAuth 2.1 recommendation for SPAs and native apps.
// The `secretHash`/`isConfidential` columns exist for a future confidential-
// client phase but are not used by the provider yet.

const SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'email',
  'address',
  'phone',
  'membership',
  'offline_access',
]

// Shape returned from admin reads — never expose secretHash.
const SAFE_SELECT = {
  id: true,
  clientId: true,
  name: true,
  redirectUris: true,
  allowedScopes: true,
  isConfidential: true,
  logoUri: true,
  createdAt: true,
  updatedAt: true,
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function validate(data, { partial } = {}) {
  if (!partial || 'name' in data) {
    if (!data.name || typeof data.name !== 'string') throw badRequest('name is required')
  }
  if (!partial || 'redirectUris' in data) {
    const uris = data.redirectUris
    if (!Array.isArray(uris) || uris.length === 0)
      throw badRequest('redirectUris must be a non-empty array')
    for (const uri of uris) {
      let parsed
      try {
        parsed = new URL(uri)
      } catch {
        throw badRequest(`Invalid redirect URI: ${uri}`)
      }
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        throw badRequest(`Redirect URI must be https (or localhost): ${uri}`)
      }
    }
  }
  if (!partial || 'allowedScopes' in data) {
    const scopes = data.allowedScopes
    if (!Array.isArray(scopes) || scopes.length === 0)
      throw badRequest('allowedScopes must be a non-empty array')
    const unknown = scopes.filter((s) => !SUPPORTED_SCOPES.includes(s))
    if (unknown.length) throw badRequest(`Unsupported scopes: ${unknown.join(', ')}`)
    if (!scopes.includes('openid')) throw badRequest('allowedScopes must include "openid"')
  }
}

async function create(data) {
  validate(data)
  try {
    return await prisma.oAuthClient.create({
      data: {
        clientId: data.clientId || crypto.randomUUID(),
        name: data.name,
        redirectUris: data.redirectUris,
        allowedScopes: data.allowedScopes,
        isConfidential: false,
        logoUri: data.logoUri ?? null,
      },
      select: SAFE_SELECT,
    })
  } catch (err) {
    if (err.code === 'P2002')
      throw Object.assign(new Error('clientId already exists'), { status: 409 })
    throw err
  }
}

async function list() {
  return prisma.oAuthClient.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } })
}

async function findById(id) {
  const client = await prisma.oAuthClient.findUnique({ where: { id }, select: SAFE_SELECT })
  if (!client) throw Object.assign(new Error('OAuth client not found'), { status: 404 })
  return client
}

async function update(id, data) {
  await findById(id)
  validate(data, { partial: true })
  const patch = {}
  for (const key of ['name', 'redirectUris', 'allowedScopes', 'logoUri']) {
    if (key in data) patch[key] = data[key]
  }
  return prisma.oAuthClient.update({ where: { id }, data: patch, select: SAFE_SELECT })
}

async function remove(id) {
  await findById(id)
  await prisma.oAuthClient.delete({ where: { id } })
}

// Map a stored OAuthClient to node-oidc-provider client metadata (the shape its
// adapter's Client model must return). Public client → PKCE, no auth method.
function toProviderClient(client) {
  return {
    client_id: client.clientId,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: client.allowedScopes.join(' '),
    ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
  }
}

// Provider client lookup (by clientId) returning provider metadata, or undefined.
async function findProviderClientById(clientId) {
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client) return undefined
  return toProviderClient(client)
}

module.exports = {
  SUPPORTED_SCOPES,
  create,
  list,
  findById,
  update,
  remove,
  toProviderClient,
  findProviderClientById,
}
