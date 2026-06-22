'use strict'

jest.mock('../src/config/prisma', () => ({
  oAuthClient: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

const prisma = require('../src/config/prisma')
const service = require('../src/services/oauthClient.service')

const VALID = {
  name: 'Acme App',
  redirectUris: ['https://acme.example/callback'],
  allowedScopes: ['openid', 'profile'],
}

describe('oauthClient.service.create — validation', () => {
  test('rejects a missing name', async () => {
    await expect(service.create({ ...VALID, name: undefined })).rejects.toMatchObject({
      status: 400,
    })
  })

  test('rejects empty redirectUris', async () => {
    await expect(service.create({ ...VALID, redirectUris: [] })).rejects.toMatchObject({
      status: 400,
    })
  })

  test('rejects a non-https redirect URI', async () => {
    await expect(
      service.create({ ...VALID, redirectUris: ['http://acme.example/cb'] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('allows a localhost http redirect URI (dev)', async () => {
    prisma.oAuthClient.create.mockResolvedValue({ id: '1' })
    await expect(
      service.create({ ...VALID, redirectUris: ['http://localhost:3000/cb'] }),
    ).resolves.toBeDefined()
  })

  test('rejects unsupported scopes', async () => {
    await expect(
      service.create({ ...VALID, allowedScopes: ['openid', 'wildcard'] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('rejects scopes that omit openid', async () => {
    await expect(service.create({ ...VALID, allowedScopes: ['profile'] })).rejects.toMatchObject({
      status: 400,
    })
  })

  test('creates a public client, generating a clientId when absent', async () => {
    prisma.oAuthClient.create.mockResolvedValue({ id: '1', clientId: 'generated' })
    await service.create(VALID)
    const args = prisma.oAuthClient.create.mock.calls[0][0]
    expect(args.data.clientId).toEqual(expect.any(String))
    expect(args.data.isConfidential).toBe(false)
    // never selects/returns the secret hash
    expect(args.select.secretHash).toBeUndefined()
  })

  test('maps a P2002 to a 409 conflict', async () => {
    prisma.oAuthClient.create.mockRejectedValue({ code: 'P2002' })
    await expect(service.create({ ...VALID, clientId: 'dupe' })).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe('oauthClient.service — read/update/delete', () => {
  test('findById throws 404 when missing', async () => {
    prisma.oAuthClient.findUnique.mockResolvedValue(null)
    await expect(service.findById('nope')).rejects.toMatchObject({ status: 404 })
  })

  test('remove deletes after existence check', async () => {
    prisma.oAuthClient.findUnique.mockResolvedValue({ id: '1' })
    await service.remove('1')
    expect(prisma.oAuthClient.delete).toHaveBeenCalledWith({ where: { id: '1' } })
  })
})

describe('oauthClient.service — provider metadata mapping', () => {
  test('toProviderClient maps a public PKCE client', () => {
    const meta = service.toProviderClient({
      clientId: 'c1',
      name: 'Acme',
      redirectUris: ['https://acme/cb'],
      allowedScopes: ['openid', 'profile', 'email'],
      logoUri: 'https://acme/logo.png',
    })
    expect(meta).toEqual({
      client_id: 'c1',
      client_name: 'Acme',
      redirect_uris: ['https://acme/cb'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email',
      logo_uri: 'https://acme/logo.png',
    })
  })

  test('findProviderClientById returns undefined for an unknown client', async () => {
    prisma.oAuthClient.findUnique.mockResolvedValue(null)
    await expect(service.findProviderClientById('ghost')).resolves.toBeUndefined()
  })
})
