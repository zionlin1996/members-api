'use strict';

require('dotenv').config();

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Comma-separated list of browser origins allowed to make credentialed
  // (cookie-bearing) requests. Defaults to the local Vite dev server.
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  DATABASE_URL: required('DATABASE_URL'),

  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || '',
  WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME || '',
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN || '',

  // OIDC issuer (this API). OIDC_ISSUER must be the public base URL of the API
  // and appears as `iss` in tokens + the discovery doc. OIDC_PRIVATE_KEY is a
  // PEM (optionally base64-encoded) RSA private key; if unset, an ephemeral key
  // is generated at boot (dev only). OIDC_CLIENT_ID is the audience of ID tokens.
  OIDC_ISSUER: process.env.OIDC_ISSUER || `http://localhost:${process.env.PORT || '3000'}`,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || 'members-web',
  OIDC_PRIVATE_KEY: process.env.OIDC_PRIVATE_KEY || '',
  // Domain used to compute member emails ({username}@EMAIL_DOMAIN) for claims.
  EMAIL_DOMAIN: process.env.EMAIL_DOMAIN || 'yangfrenz.club',

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || '',

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',
};
