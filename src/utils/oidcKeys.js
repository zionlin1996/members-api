'use strict';

const crypto = require('crypto');
const env = require('../config/env');

/**
 * OIDC signing key management.
 *
 * The issuer signs ID tokens and access tokens with an asymmetric key so that
 * any party can verify them against the published JWKS — no shared secret. The
 * private key is supplied via OIDC_PRIVATE_KEY (PEM, optionally base64-encoded)
 * and injected at runtime in production. When absent (local dev) an ephemeral
 * key pair is generated at boot and a warning is logged — fine for dev, but it
 * means tokens and the JWKS change on every restart.
 *
 * `kid` is the RFC 7638 JWK thumbprint, so it is stable for a given key and
 * survives a future migration to a full authorization server unchanged.
 */

function loadPrivateKey() {
  const raw = env.OIDC_PRIVATE_KEY;
  if (!raw) {
    // eslint-disable-next-line no-console
    console.warn(
      '[oidc] OIDC_PRIVATE_KEY not set — generating an ephemeral RSA key pair. ' +
        'Set OIDC_PRIVATE_KEY in production so tokens survive restarts.'
    );
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return privateKey;
  }

  const pem = raw.trimStart().startsWith('-----BEGIN')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  return crypto.createPrivateKey(pem);
}

const privateKey = loadPrivateKey();
const publicKey = crypto.createPublicKey(privateKey);

// Native JWK export (Node 16+) — { kty: 'RSA', n, e } for an RSA public key.
const baseJwk = publicKey.export({ format: 'jwk' });

// RFC 7638 thumbprint: SHA-256 over the canonical (lexicographically ordered)
// JWK members, base64url-encoded.
const canonical = JSON.stringify({ e: baseJwk.e, kty: baseJwk.kty, n: baseJwk.n });
const kid = crypto.createHash('sha256').update(canonical).digest('base64url');

const publicJwk = { ...baseJwk, kid, use: 'sig', alg: 'RS256' };

module.exports = {
  privateKey,
  publicKey,
  kid,
  ALG: 'RS256',
  jwks: { keys: [publicJwk] },
};
