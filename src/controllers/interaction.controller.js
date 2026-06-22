'use strict'

const { getProvider } = require('../oidc/provider')
const authService = require('../services/auth.service')
const passkeyService = require('../services/passkey.service')
const googleService = require('../services/google.service')
const telegramService = require('../services/telegram.service')

// SPA-driven OIDC interaction (login + consent). The Authorization Server
// redirects the browser to the first-party SPA (/interaction/:uid); the SPA
// reads details and submits results via these credentialed, same-origin XHRs.
// We use provider.interactionResult (not interactionFinished): it RETURNS the
// resume URL as a string so the SPA can navigate the top-level window to it —
// an XHR can't follow interactionFinished's 302 cross-origin.

// Resolve the authenticated member for a login submission, reusing the
// authenticate-only seam of each auth service (no first-party tokens minted).
// Throws .status 400/401/403 errors that the global handler maps to HTTP.
async function authenticate(body) {
  switch (body.method) {
    case 'password':
      return authService.verifyPassword({ username: body.username, password: body.password })
    case 'passkey':
      return passkeyService.verifyPasskeyAuthentication({
        sessionId: body.sessionId,
        credential: body.credential,
      })
    case 'telegram':
      return telegramService.verifyTelegram({ telegramData: body.telegramData })
    case 'google':
      return googleService.verifyGoogle({ profile: body.profile })
    default: {
      const err = new Error('Unsupported or missing login method')
      err.status = 400
      throw err
    }
  }
}

// GET /interaction/:uid — what the SPA needs to render login or consent.
async function details(req, res, next) {
  try {
    const provider = await getProvider()
    const interaction = await provider.interactionDetails(req, res)
    const { prompt, params } = interaction
    const client = await provider.Client.find(params.client_id)
    const requestedScopes = (params.scope || '').split(' ').filter(Boolean)

    return res.json({
      uid: interaction.uid,
      prompt: prompt.name, // 'login' | 'consent'
      client: client
        ? { clientId: client.clientId, name: client.clientName, logoUri: client.logoUri }
        : { clientId: params.client_id },
      requestedScopes,
      missingScopes: prompt.details.missingOIDCScope || [],
      missingClaims: prompt.details.missingOIDCClaims || [],
    })
  } catch (err) {
    next(err)
  }
}

// POST /interaction/:uid/login — authenticate, then resolve the login prompt.
async function login(req, res, next) {
  try {
    const provider = await getProvider()
    const member = await authenticate(req.body || {})
    const redirectTo = await provider.interactionResult(
      req,
      res,
      { login: { accountId: member.id, remember: true } },
      { mergeWithLastSubmission: false },
    )
    return res.json({ redirectTo })
  } catch (err) {
    next(err)
  }
}

// POST /interaction/:uid/consent — persist the Grant for the approved
// scopes/claims, then resolve the consent prompt.
async function consent(req, res, next) {
  try {
    const provider = await getProvider()
    const interaction = await provider.interactionDetails(req, res)
    const { prompt, params, session, grantId } = interaction

    const grant = grantId
      ? await provider.Grant.find(grantId)
      : new provider.Grant({ accountId: session.accountId, clientId: params.client_id })

    const d = prompt.details
    if (d.missingOIDCScope) grant.addOIDCScope(d.missingOIDCScope.join(' '))
    if (d.missingOIDCClaims) grant.addOIDCClaims(d.missingOIDCClaims)
    if (d.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(d.missingResourceScopes)) {
        grant.addResourceScope(indicator, scopes.join(' '))
      }
    }

    const savedGrantId = await grant.save()
    const redirectTo = await provider.interactionResult(
      req,
      res,
      { consent: { grantId: savedGrantId } },
      { mergeWithLastSubmission: true },
    )
    return res.json({ redirectTo })
  } catch (err) {
    next(err)
  }
}

module.exports = { details, login, consent }
