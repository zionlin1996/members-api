'use strict'

jest.mock('../src/config/prisma', () => ({
  oidcPayload: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}))

const prisma = require('../src/config/prisma')
const PrismaAdapter = require('../src/oidc/adapter')

describe('PrismaAdapter', () => {
  const adapter = new PrismaAdapter('AccessToken')

  test('upsert writes payload + extracted columns with composite key and expiresAt', async () => {
    await adapter.upsert('abc', { grantId: 'g1', uid: 'u1', accountId: 'm1' }, 3600)

    expect(prisma.oidcPayload.upsert).toHaveBeenCalledTimes(1)
    const args = prisma.oidcPayload.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ type_id: { type: 'AccessToken', id: 'abc' } })
    expect(args.create).toMatchObject({ id: 'abc', type: 'AccessToken', grantId: 'g1', uid: 'u1' })
    expect(args.update.expiresAt).toBeInstanceOf(Date)
    expect(args.update.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('upsert with no expiresIn stores null expiresAt', async () => {
    await adapter.upsert('abc', {}, undefined)
    const args = prisma.oidcPayload.upsert.mock.calls[0][0]
    expect(args.update.expiresAt).toBeNull()
    expect(args.create.grantId).toBeNull()
  })

  test('find returns the stored payload', async () => {
    prisma.oidcPayload.findUnique.mockResolvedValue({
      payload: { accountId: 'm1' },
      expiresAt: new Date(Date.now() + 10000),
      consumedAt: null,
    })
    await expect(adapter.find('abc')).resolves.toEqual({ accountId: 'm1' })
  })

  test('find treats an expired row as absent', async () => {
    prisma.oidcPayload.findUnique.mockResolvedValue({
      payload: { accountId: 'm1' },
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    })
    await expect(adapter.find('abc')).resolves.toBeUndefined()
  })

  test('find on a consumed row surfaces a truthy `consumed` timestamp', async () => {
    const consumedAt = new Date(Date.now() - 500)
    prisma.oidcPayload.findUnique.mockResolvedValue({
      payload: { accountId: 'm1' },
      expiresAt: null,
      consumedAt,
    })
    const found = await adapter.find('abc')
    expect(found.accountId).toBe('m1')
    expect(found.consumed).toBe(Math.floor(consumedAt.getTime() / 1000))
  })

  test('findByUid queries the unique uid column', async () => {
    prisma.oidcPayload.findUnique.mockResolvedValue({ payload: { uid: 'u1' }, expiresAt: null })
    await adapter.findByUid('u1')
    expect(prisma.oidcPayload.findUnique).toHaveBeenCalledWith({ where: { uid: 'u1' } })
  })

  test('consume sets consumedAt without deleting', async () => {
    await adapter.consume('abc')
    expect(prisma.oidcPayload.update).toHaveBeenCalledWith({
      where: { type_id: { type: 'AccessToken', id: 'abc' } },
      data: { consumedAt: expect.any(Date) },
    })
    expect(prisma.oidcPayload.delete).not.toHaveBeenCalled()
  })

  test('destroy is idempotent (swallows missing-record errors)', async () => {
    prisma.oidcPayload.delete.mockRejectedValue(new Error('not found'))
    await expect(adapter.destroy('gone')).resolves.toBeUndefined()
  })

  test('revokeByGrantId deletes every row sharing the grantId', async () => {
    await adapter.revokeByGrantId('g1')
    expect(prisma.oidcPayload.deleteMany).toHaveBeenCalledWith({ where: { grantId: 'g1' } })
  })
})
