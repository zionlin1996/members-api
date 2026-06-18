'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const oidcKeys = require('./oidcKeys');

const ms = require('./ms');

const RS256 = { algorithm: oidcKeys.ALG, keyid: oidcKeys.kid };

/**
 * Sign an access token for a given member id.
 *
 * Signed with the asymmetric OIDC key (RS256) so resource servers can verify it
 * against the published JWKS. `aud` is the issuer itself (this API is the
 * resource); `iss` lets verifiers pin the issuer.
 */
function signAccessToken(memberId) {
  return jwt.sign({ type: 'access' }, oidcKeys.privateKey, {
    ...RS256,
    subject: memberId,
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_ISSUER,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

/**
 * Sign an OIDC ID token. `claims` carries the standard identity claims; `sub`,
 * `iss`, `aud`, `iat` and `exp` are set here. Audience is the client id.
 */
function signIdToken(claims) {
  const { sub, ...rest } = claims;
  return jwt.sign(rest, oidcKeys.privateKey, {
    ...RS256,
    subject: sub,
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_CLIENT_ID,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

/**
 * Sign a refresh token for a given member id.
 */
function signRefreshToken(memberId) {
  return jwt.sign({ sub: memberId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  });
}

/**
 * Verify an access token. Returns the decoded payload or throws.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, oidcKeys.publicKey, {
    algorithms: [oidcKeys.ALG],
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_ISSUER,
  });
}

/**
 * Verify a refresh token. Returns the decoded payload or throws.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

/**
 * Parse the refresh token TTL string (e.g. "7d") into a future Date.
 */
function refreshTokenExpiresAt() {
  const ttl = env.JWT_REFRESH_EXPIRES_IN;
  return new Date(Date.now() + ms(ttl));
}

function signStateToken(payload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '10m' });
}

function verifyStateToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

module.exports = {
  signAccessToken,
  signIdToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
  signStateToken,
  verifyStateToken,
};
