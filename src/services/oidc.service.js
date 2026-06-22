'use strict'

const env = require('../config/env')
const memberService = require('./member.service')
const { signIdToken } = require('../utils/jwt')
const oidcKeys = require('../utils/oidcKeys')

// Namespace for non-standard (custom) claims.
const NS = 'https://yangfrenz.club/'

// Scope sets used by first-party endpoints. The ID token stays lean (identity
// only); /userinfo releases everything the first-party app is entitled to.
const ID_TOKEN_SCOPES = ['openid', 'profile', 'email']
const FIRST_PARTY_SCOPES = ['openid', 'profile', 'email', 'address', 'phone', 'membership']

const ALL_SCOPES = ['openid', 'profile', 'email', 'address', 'phone', 'membership']

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined))
}

function fmtBirthdate(v) {
  if (!v) return undefined
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10) // already YYYY-MM-DD (or ISO)
}

function toEpoch(v) {
  return v ? Math.floor(new Date(v).getTime() / 1000) : undefined
}

function buildAddress(p) {
  const present = prune({
    street_address: p.streetAddress,
    locality: p.locality,
    region: p.region,
    postal_code: p.postalCode,
    country: p.country,
  })
  if (Object.keys(present).length === 0) return undefined
  const formatted = [
    p.streetAddress,
    [p.postalCode, p.locality].filter(Boolean).join(' '),
    p.region,
    p.country,
  ]
    .filter(Boolean)
    .join('\n')
  return { formatted, ...present }
}

/**
 * Map a member (+ optional profile) to OIDC claims for the granted scopes. This
 * is the single source of truth for the claims emitted in ID tokens, from
 * /userinfo, and (later) by the authorization server's `claims` resolver.
 *
 * `sub` is the immutable Member.id (never the mutable username). Null/absent
 * values are pruned. Claims are released only for scopes that were granted
 * (default deny).
 */
function getClaims(member, profile, scopes) {
  const p = profile ?? {}
  const granted = new Set(scopes ?? [])
  const claims = { sub: member.id }

  if (granted.has('profile')) {
    Object.assign(
      claims,
      prune({
        name: member.displayName,
        preferred_username: member.username,
        given_name: p.givenName,
        family_name: p.familyName,
        middle_name: p.middleName,
        nickname: p.nickname,
        gender: p.gender,
        birthdate: fmtBirthdate(p.birthdate),
        zoneinfo: p.zoneinfo,
        locale: p.locale,
        picture: p.picture,
        website: p.website,
        profile: p.profileUrl,
        updated_at: toEpoch(member.updatedAt),
      }),
    )
  }

  if (granted.has('email')) {
    claims.email = `${member.username}@${env.EMAIL_DOMAIN}`
    claims.email_verified = member.status === 'ACTIVE'
  }

  if (granted.has('address')) {
    const address = buildAddress(p)
    if (address) claims.address = address
  }

  if (granted.has('phone')) {
    Object.assign(
      claims,
      prune({
        phone_number: p.phoneNumber,
        phone_number_verified: p.phoneNumber ? p.phoneVerified : undefined,
      }),
    )
  }

  if (granted.has('membership')) {
    Object.assign(
      claims,
      prune({
        [`${NS}membership_status`]: member.status,
        [`${NS}member_since`]: toEpoch(member.createdAt),
        [`${NS}pronouns`]: p.pronouns,
      }),
    )
  }

  return claims
}

/**
 * Issue a signed ID token for a member id. The ID token is lean (identity
 * claims only) — full profile data is fetched from /userinfo.
 */
async function issueIdToken(memberId) {
  const member = await memberService.findById(memberId)
  return signIdToken(getClaims(member, null, ID_TOKEN_SCOPES))
}

/** Build the OIDC discovery document. */
function discoveryDocument() {
  const issuer = env.OIDC_ISSUER
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    userinfo_endpoint: `${issuer}/auth/userinfo`,
    response_types_supported: ['id_token token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [oidcKeys.ALG],
    scopes_supported: ALL_SCOPES,
    claims_supported: [
      'sub',
      'name',
      'given_name',
      'family_name',
      'middle_name',
      'nickname',
      'preferred_username',
      'picture',
      'website',
      'profile',
      'gender',
      'birthdate',
      'zoneinfo',
      'locale',
      'updated_at',
      'email',
      'email_verified',
      'address',
      'phone_number',
      'phone_number_verified',
      `${NS}membership_status`,
      `${NS}member_since`,
      `${NS}pronouns`,
    ],
    // NOTE: no authorization_endpoint / token_endpoint yet — this issuer mints
    // tokens through its own login endpoints (token-layer issuer). Those are
    // added if/when it becomes a full authorization server.
  }
}

module.exports = {
  getClaims,
  issueIdToken,
  discoveryDocument,
  FIRST_PARTY_SCOPES,
  jwks: oidcKeys.jwks,
}
