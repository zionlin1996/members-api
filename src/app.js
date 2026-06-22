'use strict'

const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')

const env = require('./config/env')
const authRoutes = require('./routes/auth.routes')
const memberRoutes = require('./routes/member.routes')
const adminRoutes = require('./routes/admin.routes')
const interactionRoutes = require('./routes/interaction.routes')
const { errorHandler } = require('./middleware/error.middleware')

const app = express()

// Credentialed CORS for the first-party SPA: the browser sends/receives the
// httpOnly refresh cookie (and the OIDC interaction cookies), so the response
// must echo a specific origin (not *) and allow credentials. Scoped to our own
// routers — the OIDC provider governs CORS on its own endpoints (clientBasedCORS),
// so we must NOT layer a second CORS source on top of the provider mount.
const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const corsOptions = { origin: allowedOrigins, credentials: true }

app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/auth', cors(corsOptions), authRoutes)
app.use('/members', cors(corsOptions), memberRoutes)
app.use('/admin', cors(corsOptions), adminRoutes)
// SPA-driven OIDC login/consent interaction API. MUST be mounted at /interaction
// to match the pathname of interactions.url — the provider scopes the
// `_interaction` cookie to that path, so a different prefix would never receive it.
app.use('/interaction', cors(corsOptions), interactionRoutes)

// Back-compat alias: the former hand-rolled JWKS lived at /.well-known/jwks.json;
// the provider now publishes it at /jwks (and advertises that in discovery).
app.get('/.well-known/jwks.json', (_req, res) => res.redirect(301, '/jwks'))

// OIDC Authorization Server (node-oidc-provider). It owns /authorize, /token,
// /userinfo, /.well-known/openid-configuration, /jwks, /session/end,
// /token/introspection, /token/revocation. Mounted LAST as a terminal catch-all:
// the routers above handle their own paths first, and only OIDC routes fall
// through to here. The provider is loaded lazily (it's ESM, imported async) on
// the first request, so the rest of the app — and tests that never touch OIDC —
// stay synchronous and don't pull in the provider.
let providerCallbackPromise
app.use((req, res, next) => {
  if (!providerCallbackPromise) {
    providerCallbackPromise = require('./oidc/provider')
      .getProvider()
      .then((provider) => provider.callback())
  }
  providerCallbackPromise.then((callback) => callback(req, res, next)).catch(next)
})

app.use(errorHandler)

module.exports = app
