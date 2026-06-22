'use strict'

const env = require('../config/env')
const configuration = require('./configuration')

// node-oidc-provider v9 is ESM-only, so it's loaded via dynamic import() from
// this CommonJS codebase (works unconditionally on Node 22). Construction is
// therefore async; the provider is memoized so app bootstrap builds it once.
let _provider

async function getProvider() {
  if (_provider) return _provider
  const { Provider } = await import('oidc-provider')
  _provider = new Provider(env.OIDC_ISSUER, configuration)
  // Behind CapRover's reverse proxy → trust X-Forwarded-* for correct
  // https/host detection (cookie Secure, redirect URLs, issuer checks).
  _provider.proxy = true
  return _provider
}

module.exports = { getProvider }
