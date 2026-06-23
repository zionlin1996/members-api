'use strict'

jest.mock('../src/config/prisma', () => ({
  oidcPayload: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
}))
jest.mock('../src/services/oauthClient.service', () => ({
  findProviderClientById: jest.fn(),
}))

const prisma = require('../src/config/prisma')
const oauthClientService = require('../src/services/oauthClient.service')
const service = require('../src/services/connections.service')

const MEMBER = 'member-1'

function grantRow(id, clientId, scope, iat, extra = {}) {
  return {
    id,
    expiresAt: new Date(Date.now() + 1e6),
    payload: { accountId: MEMBER, clientId, openid: { scope }, iat },
    ...extra,
  }
}

describe('connections.service.list', () => {
  test('queries Grant rows by accountId and maps client metadata', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([
      grantRow('g1', 'client-1', 'openid profile', 1000),
    ])
    oauthClientService.findProviderClientById.mockResolvedValue({
      client_name: 'Acme',
      logo_uri: 'https://acme/logo.png',
    })

    const out = await service.list(MEMBER)

    expect(prisma.oidcPayload.findMany).toHaveBeenCalledWith({
      where: { type: 'Grant', payload: { path: ['accountId'], equals: MEMBER } },
    })
    expect(out).toEqual([
      {
        clientId: 'client-1',
        name: 'Acme',
        logoUri: 'https://acme/logo.png',
        scopes: ['openid', 'profile'],
        authorizedAt: 1000,
      },
    ])
  })

  test('dedupes by clientId, unions scopes, keeps the latest authorizedAt', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([
      grantRow('g1', 'client-1', 'openid profile', 1000),
      grantRow('g2', 'client-1', 'openid email', 2000),
    ])
    oauthClientService.findProviderClientById.mockResolvedValue({ client_name: 'Acme' })

    const [conn] = await service.list(MEMBER)
    expect(conn.clientId).toBe('client-1')
    expect(conn.scopes.sort()).toEqual(['email', 'openid', 'profile'])
    expect(conn.authorizedAt).toBe(2000)
  })

  test('drops expired grants', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([
      {
        id: 'g1',
        expiresAt: new Date(Date.now() - 1000),
        payload: { accountId: MEMBER, clientId: 'c', openid: { scope: 'openid' } },
      },
    ])
    await expect(service.list(MEMBER)).resolves.toEqual([])
  })

  test('falls back to the clientId as name when the client was deleted', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([grantRow('g1', 'gone-client', 'openid', 5)])
    oauthClientService.findProviderClientById.mockResolvedValue(undefined)
    const [conn] = await service.list(MEMBER)
    expect(conn.name).toBe('gone-client')
    expect(conn.logoUri).toBeNull()
  })
})

describe('connections.service.revoke', () => {
  test('404 when the member has no grant for the client', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([grantRow('g1', 'other-client', 'openid', 1)])
    await expect(service.revoke(MEMBER, 'client-1')).rejects.toMatchObject({ status: 404 })
  })

  test('deletes tokens (by grantId) and the grant rows for every matching grant', async () => {
    prisma.oidcPayload.findMany.mockResolvedValue([
      grantRow('g1', 'client-1', 'openid', 1),
      grantRow('g2', 'client-1', 'openid', 2),
      grantRow('g3', 'other', 'openid', 3),
    ])
    await service.revoke(MEMBER, 'client-1')

    expect(prisma.oidcPayload.deleteMany).toHaveBeenCalledWith({ where: { grantId: 'g1' } })
    expect(prisma.oidcPayload.deleteMany).toHaveBeenCalledWith({
      where: { type: 'Grant', id: 'g1' },
    })
    expect(prisma.oidcPayload.deleteMany).toHaveBeenCalledWith({ where: { grantId: 'g2' } })
    expect(prisma.oidcPayload.deleteMany).toHaveBeenCalledWith({
      where: { type: 'Grant', id: 'g2' },
    })
    // the other client's grant is untouched
    expect(prisma.oidcPayload.deleteMany).not.toHaveBeenCalledWith({ where: { grantId: 'g3' } })
  })
})
