'use strict'

require('dotenv').config()

const required = (key) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var: ${key}`)
  return value
}

// ── Domain topology ──────────────────────────────────────────────────────────
// All public hostnames are derived from three base vars, so production only
// configures these three. Everything domain-shaped below (CORS origin, WebAuthn
// RP, OIDC issuer/audience, email domain) is derived from them. Each derived
// value can still be overridden by its own env var — needed for local dev, where
// the app/API run on http://localhost with ports that aren't derivable.
const DOMAIN = process.env.DOMAIN || 'yangfrenz.club'
const API_SUBDOMAIN = process.env.API_SUBDOMAIN || 'members-api'
const APP_SUBDOMAIN = process.env.APP_SUBDOMAIN || 'members'

const APP_HOST = `${APP_SUBDOMAIN}.${DOMAIN}` // members.yangfrenz.club
// SPA origin — also where the OIDC AS redirects for login/consent. Overridable
// for dev (the SPA runs on http://localhost:5173, which isn't derivable).
const APP_ORIGIN = process.env.APP_ORIGIN || `https://${APP_HOST}`
const API_ORIGIN = `https://${API_SUBDOMAIN}.${DOMAIN}` // https://members-api.yangfrenz.club

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  DOMAIN,
  APP_ORIGIN,
  API_ORIGIN,

  // Browser origins allowed to make credentialed (cookie-bearing) requests.
  // Derived from APP_SUBDOMAIN.DOMAIN; comma-separated if multiple.
  CORS_ORIGIN: process.env.CORS_ORIGIN || APP_ORIGIN,

  DATABASE_URL: required('DATABASE_URL'),

  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // RP ID is the registrable domain (no scheme); origin is the app origin.
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || DOMAIN,
  WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME || '',
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN || APP_ORIGIN,

  // OIDC issuer (this API). OIDC_ISSUER is the public base URL of the API and
  // appears as `iss` in tokens + the discovery doc (derived: API_SUBDOMAIN.DOMAIN).
  // OIDC_CLIENT_ID is the audience of ID tokens (derived: the app host).
  // OIDC_PRIVATE_KEY is a PEM (optionally base64) RSA key; if unset, an ephemeral
  // key is generated at boot (dev only).
  OIDC_ISSUER: process.env.OIDC_ISSUER || API_ORIGIN,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || APP_HOST,
  OIDC_PRIVATE_KEY: process.env.OIDC_PRIVATE_KEY || '',

  // OIDC Authorization Server (Phase 3). Cookie-signing keys for the provider's
  // interaction/session cookies. OIDC_API_RESOURCE is the audience stamped on
  // third-party JWT access tokens — kept DISTINCT from OIDC_ISSUER so they can't
  // pass the first-party auth.middleware (which asserts aud === OIDC_ISSUER).
  // APP_ORIGIN is where the provider redirects for login/consent (SPA routes).
  OIDC_COOKIE_KEYS: (process.env.OIDC_COOKIE_KEYS || process.env.JWT_ACCESS_SECRET || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  OIDC_API_RESOURCE: process.env.OIDC_API_RESOURCE || `${API_ORIGIN}/api`,
  OIDC_ADAPTER: process.env.OIDC_ADAPTER || 'prisma',
  // Domain used to compute member emails ({username}@EMAIL_DOMAIN) for claims.
  EMAIL_DOMAIN: process.env.EMAIL_DOMAIN || DOMAIN,

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || '',

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',
}
