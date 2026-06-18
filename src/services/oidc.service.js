'use strict';

const env = require('../config/env');
const memberService = require('./member.service');
const { signIdToken } = require('../utils/jwt');
const oidcKeys = require('../utils/oidcKeys');

/**
 * Map a member to OIDC standard claims. This is the single source of truth for
 * the identity claims emitted in ID tokens and from /userinfo — keep it here so
 * a future authorization server can reuse it as its `claims` resolver.
 *
 * `sub` is the immutable Member.id (never the mutable username), so the subject
 * identifier is stable for the life of the account.
 */
function getClaims(member) {
  return {
    sub: member.id,
    name: member.displayName,
    preferred_username: member.username,
    email: `${member.username}@${env.EMAIL_DOMAIN}`,
    email_verified: member.status === 'ACTIVE',
    updated_at: Math.floor(new Date(member.updatedAt).getTime() / 1000),
  };
}

/**
 * Issue a signed ID token for a member id. Claims are read fresh from the DB so
 * callers needn't have the full member loaded.
 */
async function issueIdToken(memberId) {
  const member = await memberService.findById(memberId);
  return signIdToken(getClaims(member));
}

/** Build the OIDC discovery document. */
function discoveryDocument() {
  const issuer = env.OIDC_ISSUER;
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    userinfo_endpoint: `${issuer}/auth/userinfo`,
    response_types_supported: ['id_token token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [oidcKeys.ALG],
    scopes_supported: ['openid', 'profile', 'email'],
    claims_supported: [
      'sub',
      'name',
      'preferred_username',
      'email',
      'email_verified',
      'updated_at',
    ],
    // NOTE: no authorization_endpoint / token_endpoint yet — this issuer mints
    // tokens through its own login endpoints (token-layer issuer). Those are
    // added if/when it becomes a full authorization server.
  };
}

module.exports = {
  getClaims,
  issueIdToken,
  discoveryDocument,
  jwks: oidcKeys.jwks,
};
