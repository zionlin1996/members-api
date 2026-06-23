'use strict'

const env = require('../config/env')
const oidcKeys = require('../utils/oidcKeys')
const memberService = require('../services/member.service')
const profileService = require('../services/profile.service')
const oauthClientService = require('../services/oauthClient.service')
const oidcService = require('../services/oidc.service')
const PrismaAdapter = require('./adapter')

const NS = 'https://yangfrenz.club/'

// Whether the issuer is served over HTTPS. `SameSite=None` cookies require
// `Secure`, which browsers reject over plain http — so in local dev (http
// issuer) we fall back to lax/insecure cookies. See PLAN §3b (cross-site cookies).
const isHttps = env.OIDC_ISSUER.startsWith('https://')

class ClientAdapter {
  async find(clientId) {
    return oauthClientService.findProviderClientById(clientId)
  }

  // Clients are admin-managed (not via dynamic registration), so the remaining
  // adapter methods are never exercised for the Client model.
  async upsert() {}
  async findByUid() {}
  async findByUserCode() {}
  async consume() {}
  async destroy() {}
  async revokeByGrantId() {}
}

function adapter(name) {
  return name === 'Client' ? new ClientAdapter() : new PrismaAdapter(name)
}

// Resolve a member's OIDC claims for the granted scopes, reusing the single
// claims resolver that also backs first-party /userinfo and ID tokens.
async function findAccount(ctx, sub) {
  let member
  try {
    member = await memberService.findById(sub)
  } catch {
    return undefined // unknown/deleted member → no account
  }
  const profile = await profileService.findByMemberId(sub)
  return {
    accountId: sub,
    async claims(_use, scope) {
      return oidcService.getClaims(member, profile, scope.split(' '))
    },
  }
}

module.exports = {
  adapter,
  findAccount,

  // Same RS256 key the token issuer already uses (stable RFC-7638 kid), so the
  // provider's published JWKS matches existing first-party tokens.
  jwks: { keys: [oidcKeys.privateJwk] },

  scopes: ['openid', 'profile', 'email', 'address', 'phone', 'membership', 'offline_access'],

  // Declares which claim names each scope may release. getClaims already gates by
  // scope; the provider additionally restricts to claims declared here.
  claims: {
    openid: ['sub'],
    profile: [
      'name',
      'preferred_username',
      'given_name',
      'family_name',
      'middle_name',
      'nickname',
      'gender',
      'birthdate',
      'zoneinfo',
      'locale',
      'picture',
      'website',
      'profile',
      'updated_at',
    ],
    email: ['email', 'email_verified'],
    address: ['address'],
    phone: ['phone_number', 'phone_number_verified'],
    membership: [`${NS}membership_status`, `${NS}member_since`, `${NS}pronouns`],
  },

  // The provider's default authorization route is /auth and userinfo is /me —
  // /auth collides with the first-party auth router (mounted first, so the
  // provider would never see it). Remap to non-colliding paths. The remaining
  // defaults (/token, /jwks, /session/end, /token/{introspection,revocation})
  // don't collide.
  routes: {
    authorization: '/authorize',
    userinfo: '/userinfo',
  },

  // PKCE is mandatory — all third-party clients are public (no secret).
  pkce: { required: () => true },

  // The provider redirects to dedicated SPA routes for login + consent. The SPA
  // calls back into the API's /oidc-interaction endpoints (see interaction.routes).
  interactions: {
    url(ctx, interaction) {
      return `${env.APP_ORIGIN}/interaction/${interaction.uid}`
    },
  },

  cookies: {
    keys: env.OIDC_COOKIE_KEYS,
    long: { httpOnly: true, sameSite: isHttps ? 'none' : 'lax', secure: isHttps },
    short: { httpOnly: true, sameSite: isHttps ? 'none' : 'lax', secure: isHttps },
  },

  claimsParameter: { enabled: false },

  features: {
    devInteractions: { enabled: false },
    revocation: { enabled: true },
    introspection: { enabled: true },
  },

  // Third-party access tokens are OPAQUE (the provider's default): they're
  // consumed at the provider's own /userinfo, which rejects resource-bound JWTs.
  // Audience isolation from first-party endpoints still holds for free — an
  // opaque token is not a valid RS256 JWT, so the first-party auth.middleware
  // (which requires a JWT with aud === OIDC_ISSUER) rejects it. Self-verifiable
  // JWT access tokens for a dedicated resource server (aud = OIDC_API_RESOURCE)
  // are deferred to when such a resource server actually exists; see
  // features.resourceIndicators in the design doc.

  ttl: {
    AccessToken: 60 * 60,
    AuthorizationCode: 10 * 60,
    IdToken: 60 * 60,
    Interaction: 60 * 60,
    Session: 14 * 24 * 60 * 60,
    Grant: 14 * 24 * 60 * 60,
  },
}
