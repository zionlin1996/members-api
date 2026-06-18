'use strict'

jest.mock('../src/config/prisma', () => ({
  profile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}))

const prisma = require('../src/config/prisma')
const profileService = require('../src/services/profile.service')

const MEMBER_ID = 'member-uuid-1'

beforeEach(() => jest.clearAllMocks())

describe('profile.service.findByMemberId', () => {
  it('returns the existing profile', async () => {
    prisma.profile.findUnique.mockResolvedValue({ givenName: 'Yang', country: 'CH' })
    const p = await profileService.findByMemberId(MEMBER_ID)
    expect(p.givenName).toBe('Yang')
  })

  it('returns a blank profile when none exists (no write)', async () => {
    prisma.profile.findUnique.mockResolvedValue(null)
    const p = await profileService.findByMemberId(MEMBER_ID)
    expect(p.givenName).toBeNull()
    expect(p.phoneVerified).toBe(false)
    expect(prisma.profile.upsert).not.toHaveBeenCalled()
  })
})

describe('profile.service.update', () => {
  it('upserts normalized, whitelisted fields', async () => {
    prisma.profile.upsert.mockResolvedValue({ givenName: 'Yang', country: 'CH' })

    await profileService.update(MEMBER_ID, {
      givenName: '  Yang  ',
      country: 'ch',
      birthdate: '1990-05-20',
      extra: 'ignored',
    })

    const arg = prisma.profile.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ memberId: MEMBER_ID })
    expect(arg.update.givenName).toBe('Yang') // trimmed
    expect(arg.update.country).toBe('CH') // uppercased
    expect(arg.update.birthdate instanceof Date).toBe(true)
    expect('extra' in arg.update).toBe(false) // non-whitelisted dropped
    expect(arg.create.memberId).toBe(MEMBER_ID) // create includes the FK
  })

  it('throws 400 on an invalid field and never writes', async () => {
    await expect(profileService.update(MEMBER_ID, { locale: 'english' })).rejects.toMatchObject({
      status: 400,
    })
    expect(prisma.profile.upsert).not.toHaveBeenCalled()
  })

  it('throws 400 when there is nothing to update', async () => {
    await expect(profileService.update(MEMBER_ID, {})).rejects.toMatchObject({ status: 400 })
    await expect(profileService.update(MEMBER_ID, { extra: 'ignored' })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('clears a field when set to empty string', async () => {
    prisma.profile.upsert.mockResolvedValue({})
    await profileService.update(MEMBER_ID, { nickname: '' })
    const arg = prisma.profile.upsert.mock.calls[0][0]
    expect(arg.update.nickname).toBeNull()
  })
})
