'use strict'

// Audience isolation is the core coexistence guarantee of Phase 3: third-party
// access tokens minted by the Authorization Server carry aud = OIDC_API_RESOURCE
// (NOT OIDC_ISSUER), so the first-party auth.middleware — which asserts
// aud === OIDC_ISSUER — must reject them even though they're signed with the
// same RS256 key and verify against the shared JWKS.

jest.mock('../src/config/prisma', () => ({
  member: { findUnique: jest.fn() },
}))

const request = require('supertest')
const jwt = require('jsonwebtoken')

const app = require('../src/app')
const prisma = require('../src/config/prisma')
const env = require('../src/config/env')
const oidcKeys = require('../src/utils/oidcKeys')
const { signAccessToken } = require('../src/utils/jwt')

const MEMBER = {
  id: 'member-uuid-1',
  displayName: 'Test User',
  username: 'testuser',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
}

// A token shaped exactly like a provider-issued third-party JWT access token:
// same key + issuer, but the resource audience instead of the issuer audience.
function thirdPartyResourceToken() {
  return jwt.sign({ scope: 'openid profile' }, oidcKeys.privateKey, {
    algorithm: oidcKeys.ALG,
    keyid: oidcKeys.kid,
    subject: MEMBER.id,
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_API_RESOURCE,
    expiresIn: '1h',
  })
}

describe('audience isolation — first-party endpoints reject third-party tokens', () => {
  test('GET /auth/me rejects a token with aud=OIDC_API_RESOURCE (401)', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${thirdPartyResourceToken()}`)
    expect(res.status).toBe(401)
    expect(prisma.member.findUnique).not.toHaveBeenCalled()
  })

  test('GET /members rejects a token with aud=OIDC_API_RESOURCE (401)', async () => {
    const res = await request(app)
      .get('/members')
      .set('Authorization', `Bearer ${thirdPartyResourceToken()}`)
    expect(res.status).toBe(401)
  })

  test('a genuine first-party token (aud=OIDC_ISSUER) is still accepted', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER)
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${signAccessToken(MEMBER.id)}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: MEMBER.id, username: 'testuser' })
  })

  test('sanity: OIDC_API_RESOURCE differs from OIDC_ISSUER', () => {
    expect(env.OIDC_API_RESOURCE).not.toBe(env.OIDC_ISSUER)
  })
})
