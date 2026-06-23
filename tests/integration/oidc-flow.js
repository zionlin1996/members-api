'use strict'

/*
 * Full Authorization-Server flow, end to end, against the REAL provider.
 *
 * jest can't dynamic-import the ESM oidc-provider without --experimental-vm-modules,
 * so this runs under plain Node (which imports ESM natively):  `yarn test:oidc`.
 * It exercises /authorize → SPA interaction (login + consent) → /token (PKCE) →
 * /userinfo, asserting scoped-claim release and that the opaque third-party
 * access token is isolated from first-party endpoints, then the member's
 * connected-apps management (list + revoke).
 *
 * Requires a local Postgres (the same DATABASE_URL as `yarn db:migrate`): it
 * seeds a member + a public OAuth client and runs against the real Prisma
 * adapter, then cleans up the member, client, and OIDC payload rows it created.
 */

require('dotenv').config()

const assert = require('assert')
const crypto = require('crypto')
const request = require('supertest')
const bcrypt = require('bcryptjs')

const app = require('../../src/app')
const prisma = require('../../src/config/prisma')
const env = require('../../src/config/env')
const oidcClientService = require('../../src/services/oauthClient.service')
const { signAccessToken } = require('../../src/utils/jwt')

const REDIRECT_URI = 'https://client.example/callback'
const USERNAME = `oidc.flow.${Date.now()}`
const PASSWORD = 'correct horse battery staple'

const b64url = (buf) => buf.toString('base64url')

// Reduce an absolute provider URL to a path supertest can hit on its own
// (ephemeral) host. supertest binds a fresh port per request, so the provider's
// absolute resume URL (built from the request host) must be made relative.
function toPath(absoluteUrl) {
  const u = new URL(absoluteUrl)
  return u.pathname + u.search
}

function uidFromInteractionRedirect(location) {
  // APP_ORIGIN/interaction/<uid>
  const m = location.match(/\/interaction\/([^/?#]+)/)
  assert(m, `expected an interaction redirect, got: ${location}`)
  return m[1]
}

async function main() {
  let member
  let client

  try {
    // ── Seed a member (ACTIVE, password) and a public PKCE client ────────────
    member = await prisma.member.create({
      data: {
        displayName: 'OIDC Flow',
        username: USERNAME,
        status: 'ACTIVE',
        credentials: {
          create: {
            type: 'PASSWORD',
            meta: { passwordHash: await bcrypt.hash(PASSWORD, 4), backupEmail: 'x@y.z' },
          },
        },
        profile: { create: { givenName: 'Flo', familyName: 'Tester' } },
      },
    })
    client = await oidcClientService.create({
      name: 'Flow Test Client',
      redirectUris: [REDIRECT_URI],
      allowedScopes: ['openid', 'profile', 'email'],
    })

    const agent = request.agent(app)

    // ── PKCE ──────────────────────────────────────────────────────────────
    const codeVerifier = b64url(crypto.randomBytes(32))
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest())

    // ── 1. /authorize → redirect to the SPA interaction route ───────────────
    const authorizeQ = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      nonce: 'n0nce',
    })
    let res = await agent.get(`/authorize?${authorizeQ}`)
    assert.strictEqual(res.status, 303, `/authorize should 303, got ${res.status}`)
    let uid = uidFromInteractionRedirect(res.headers.location)

    // ── 2. interaction details → login prompt ───────────────────────────────
    res = await agent.get(`/interaction/${uid}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.prompt, 'login', 'first prompt should be login')
    assert.deepStrictEqual(res.body.requestedScopes, ['openid', 'profile', 'email'])

    // ── 3. submit login (password) ─────────────────────────────────────────
    res = await agent
      .post(`/interaction/${uid}/login`)
      .send({ method: 'password', username: USERNAME, password: PASSWORD })
    assert.strictEqual(
      res.status,
      200,
      `login should 200, got ${res.status} ${JSON.stringify(res.body)}`,
    )
    assert(res.body.redirectTo, 'login should return redirectTo')

    // ── 4. resume → consent prompt ──────────────────────────────────────────
    res = await agent.get(toPath(res.body.redirectTo))
    assert.strictEqual(res.status, 303, 'resume after login should 303 to consent')
    uid = uidFromInteractionRedirect(res.headers.location)
    res = await agent.get(`/interaction/${uid}`)
    assert.strictEqual(res.body.prompt, 'consent', 'second prompt should be consent')

    // ── 5. grant consent ────────────────────────────────────────────────────
    res = await agent.post(`/interaction/${uid}/consent`).send({})
    assert.strictEqual(res.status, 200, `consent should 200, got ${res.status}`)

    // ── 6. resume → redirect to the client with an auth code ────────────────
    res = await agent.get(toPath(res.body.redirectTo))
    assert.strictEqual(res.status, 303, 'resume after consent should 303 to client')
    const cb = new URL(res.headers.location)
    assert.strictEqual(
      `${cb.origin}${cb.pathname}`,
      REDIRECT_URI,
      'should redirect to client callback',
    )
    const code = cb.searchParams.get('code')
    assert(code, 'callback should carry an authorization code')
    assert.strictEqual(cb.searchParams.get('state'), 'xyz', 'state should round-trip')

    // ── 7. /token (PKCE, public client → no secret) ─────────────────────────
    res = await agent.post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.clientId,
      code_verifier: codeVerifier,
    })
    assert.strictEqual(
      res.status,
      200,
      `/token should 200, got ${res.status} ${JSON.stringify(res.body)}`,
    )
    assert(res.body.access_token, 'token response should include access_token')
    assert(res.body.id_token, 'token response should include id_token')
    const accessToken = res.body.access_token

    // ── 8. /userinfo → only granted-scope claims ────────────────────────────
    res = await agent.get('/userinfo').set('Authorization', `Bearer ${accessToken}`)
    assert.strictEqual(res.status, 200, `/userinfo should 200, got ${res.status}`)
    assert.strictEqual(res.body.sub, member.id, 'sub must be the member id')
    assert.strictEqual(
      res.body.email,
      `${USERNAME}@${env.EMAIL_DOMAIN}`,
      'email scope → email claim',
    )
    assert.strictEqual(res.body.given_name, 'Flo', 'profile scope → given_name claim')
    assert.strictEqual(
      res.body.address,
      undefined,
      'address scope was NOT granted → no address claim',
    )
    assert.strictEqual(
      res.body.phone_number,
      undefined,
      'phone scope was NOT granted → no phone claim',
    )

    // ── 9. audience isolation: the third-party token can't hit first-party ──
    res = await agent.get('/auth/me').set('Authorization', `Bearer ${accessToken}`)
    assert.strictEqual(res.status, 401, 'third-party access token must be rejected by /auth/me')

    // ── 10. connected apps: the member sees the grant they just created ─────
    // Use a genuine FIRST-PARTY token for the member (the flow only authenticated
    // them through the AS interaction, not a first-party session).
    const firstPartyAuth = { Authorization: `Bearer ${signAccessToken(member.id)}` }
    res = await agent.get('/auth/me/connections').set(firstPartyAuth)
    assert.strictEqual(res.status, 200, `/me/connections should 200, got ${res.status}`)
    const conn = res.body.connections.find((c) => c.clientId === client.clientId)
    assert(conn, 'the authorized client should appear in connections')
    assert.deepStrictEqual(
      conn.scopes.sort(),
      ['email', 'openid', 'profile'],
      'granted scopes listed',
    )

    // ── 11. revoke → grant + its tokens are gone ────────────────────────────
    res = await agent.delete(`/auth/me/connections/${client.clientId}`).set(firstPartyAuth)
    assert.strictEqual(res.status, 204, `revoke should 204, got ${res.status}`)

    res = await agent.get('/userinfo').set('Authorization', `Bearer ${accessToken}`)
    assert.strictEqual(
      res.status,
      401,
      'revoked third-party access token must no longer work at /userinfo',
    )

    res = await agent.get('/auth/me/connections').set(firstPartyAuth)
    assert(
      !res.body.connections.some((c) => c.clientId === client.clientId),
      'revoked client should be gone from connections',
    )

    // ── 12. deny path: a fresh authorize → consent → deny aborts the flow ────
    // The session cookie is still set (the member stayed logged in), so this
    // authorize lands straight on consent (the grant was revoked in step 11).
    const denyQ = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'deny-state',
      nonce: 'n0nce2',
    })
    res = await agent.get(`/authorize?${denyQ}`)
    assert.strictEqual(res.status, 303, `deny /authorize should 303, got ${res.status}`)
    uid = uidFromInteractionRedirect(res.headers.location)
    res = await agent.get(`/interaction/${uid}`)
    assert.strictEqual(res.body.prompt, 'consent', 'deny flow should reach the consent prompt')

    res = await agent.post(`/interaction/${uid}/deny`).send({})
    assert.strictEqual(res.status, 200, `deny should 200, got ${res.status}`)
    assert(res.body.redirectTo, 'deny should return a resume URL')

    res = await agent.get(toPath(res.body.redirectTo))
    assert.strictEqual(res.status, 303, 'resume after deny should 303 back to the client')
    const denyCb = new URL(res.headers.location)
    assert.strictEqual(
      `${denyCb.origin}${denyCb.pathname}`,
      REDIRECT_URI,
      'deny should redirect to the client callback',
    )
    assert.strictEqual(
      denyCb.searchParams.get('error'),
      'access_denied',
      'deny callback must carry error=access_denied',
    )
    assert.strictEqual(denyCb.searchParams.get('state'), 'deny-state', 'state should round-trip')
    assert(!denyCb.searchParams.get('code'), 'deny callback must NOT carry an authorization code')

    console.log(
      '\n✅ OIDC full-flow integration test passed ' +
        '(authorize → login → consent → token → userinfo; isolation; connections list + revoke; consent deny)',
    )
  } finally {
    if (member) {
      // Clean the OIDC payload rows (grants/sessions/tokens/codes) the flow created.
      await prisma.oidcPayload
        .deleteMany({ where: { payload: { path: ['accountId'], equals: member.id } } })
        .catch(() => {})
      await prisma.member.delete({ where: { id: member.id } }).catch(() => {})
    }
    if (client) await prisma.oAuthClient.delete({ where: { id: client.id } }).catch(() => {})
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('\n❌ OIDC full-flow integration test FAILED\n', err)
  process.exit(1)
})
