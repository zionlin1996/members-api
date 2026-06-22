'use strict'

// Unit tests for the OIDC interaction controller. The provider and the auth
// services are mocked, so these assert the controller's orchestration: login
// dispatches to the right authenticate-only seam and resolves the login prompt;
// SUSPENDED is rejected; consent builds the Grant from the missing scopes/claims.

jest.mock('../src/oidc/provider', () => ({ getProvider: jest.fn() }))
jest.mock('../src/services/auth.service', () => ({ verifyPassword: jest.fn() }))
jest.mock('../src/services/passkey.service', () => ({ verifyPasskeyAuthentication: jest.fn() }))
jest.mock('../src/services/google.service', () => ({ verifyGoogle: jest.fn() }))
jest.mock('../src/services/telegram.service', () => ({ verifyTelegram: jest.fn() }))

const { getProvider } = require('../src/oidc/provider')
const authService = require('../src/services/auth.service')
const controller = require('../src/controllers/interaction.controller')

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    end() {
      return this
    },
  }
}

describe('interaction controller — login', () => {
  test('password login authenticates and resolves the login prompt', async () => {
    authService.verifyPassword.mockResolvedValue({ id: 'm1', status: 'ACTIVE' })
    const interactionResult = jest.fn().mockResolvedValue('https://issuer/auth/uid/resume')
    getProvider.mockResolvedValue({ interactionResult })

    const req = { body: { method: 'password', username: 'u', password: 'p' } }
    const res = mockRes()
    const next = jest.fn()
    await controller.login(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(authService.verifyPassword).toHaveBeenCalledWith({ username: 'u', password: 'p' })
    expect(interactionResult).toHaveBeenCalledWith(
      req,
      res,
      { login: { accountId: 'm1', remember: true } },
      { mergeWithLastSubmission: false },
    )
    expect(res.body).toEqual({ redirectTo: 'https://issuer/auth/uid/resume' })
  })

  test('SUSPENDED member (seam throws 403) is forwarded to the error handler', async () => {
    const err = Object.assign(new Error('Account suspended'), { status: 403 })
    authService.verifyPassword.mockRejectedValue(err)
    getProvider.mockResolvedValue({ interactionResult: jest.fn() })

    const res = mockRes()
    const next = jest.fn()
    await controller.login(
      { body: { method: 'password', username: 'u', password: 'p' } },
      res,
      next,
    )

    expect(next).toHaveBeenCalledWith(err)
    expect(res.body).toBeUndefined()
  })

  test('unknown method yields a 400 error', async () => {
    getProvider.mockResolvedValue({ interactionResult: jest.fn() })
    const next = jest.fn()
    await controller.login({ body: { method: 'carrier-pigeon' } }, mockRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }))
  })
})

describe('interaction controller — consent', () => {
  test('builds a Grant from missing scopes/claims and resolves the consent prompt', async () => {
    const grant = {
      addOIDCScope: jest.fn(),
      addOIDCClaims: jest.fn(),
      addResourceScope: jest.fn(),
      save: jest.fn().mockResolvedValue('grant-1'),
    }
    const Grant = jest.fn(() => grant)
    const interactionResult = jest.fn().mockResolvedValue('https://issuer/auth/uid/resume')
    getProvider.mockResolvedValue({
      interactionDetails: jest.fn().mockResolvedValue({
        prompt: {
          name: 'consent',
          details: {
            missingOIDCScope: ['openid', 'profile'],
            missingOIDCClaims: ['email'],
            missingResourceScopes: { 'https://api/x': ['read'] },
          },
        },
        params: { client_id: 'client-1' },
        session: { accountId: 'm1' },
        grantId: undefined,
      }),
      Grant,
      interactionResult,
    })

    const req = {}
    const res = mockRes()
    const next = jest.fn()
    await controller.consent(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(Grant).toHaveBeenCalledWith({ accountId: 'm1', clientId: 'client-1' })
    expect(grant.addOIDCScope).toHaveBeenCalledWith('openid profile')
    expect(grant.addOIDCClaims).toHaveBeenCalledWith(['email'])
    expect(grant.addResourceScope).toHaveBeenCalledWith('https://api/x', 'read')
    expect(interactionResult).toHaveBeenCalledWith(
      req,
      res,
      { consent: { grantId: 'grant-1' } },
      { mergeWithLastSubmission: true },
    )
    expect(res.body).toEqual({ redirectTo: 'https://issuer/auth/uid/resume' })
  })
})

describe('interaction controller — details', () => {
  test('returns minimal JSON the SPA needs to render the prompt', async () => {
    getProvider.mockResolvedValue({
      interactionDetails: jest.fn().mockResolvedValue({
        uid: 'uid-1',
        prompt: { name: 'login', details: {} },
        params: { client_id: 'client-1', scope: 'openid profile email' },
      }),
      Client: {
        find: jest
          .fn()
          .mockResolvedValue({ clientId: 'client-1', clientName: 'Acme', logoUri: 'https://l' }),
      },
    })

    const res = mockRes()
    await controller.details({}, res, jest.fn())

    expect(res.body).toEqual({
      uid: 'uid-1',
      prompt: 'login',
      client: { clientId: 'client-1', name: 'Acme', logoUri: 'https://l' },
      requestedScopes: ['openid', 'profile', 'email'],
      missingScopes: [],
      missingClaims: [],
    })
  })
})
