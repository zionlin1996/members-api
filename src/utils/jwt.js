'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ms = require('./ms');

/**
 * Sign an access token for a given member id.
 */
function signAccessToken(memberId) {
  return jwt.sign({ sub: memberId, type: 'access' }, env.JWT_ACCESS_SECRET, {
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
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
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
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
  signStateToken,
  verifyStateToken,
};
