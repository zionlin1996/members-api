'use strict'

jest.mock('../src/config/prisma', () => ({
  profile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}))

const request = require('supertest')
const app = require('../src/app')
const prisma = require('../src/config/prisma')
const { signAccessToken } = require('../src/utils/jwt')

const MEMBER_ID = 'member-uuid-1'
const TOKEN = `Bearer ${signAccessToken(MEMBER_ID)}`

beforeEach(() => jest.clearAllMocks())

describe('GET /auth/me/profile', () => {
  it('200 — returns the profile', async () => {
    prisma.profile.findUnique.mockResolvedValue({ givenName: 'Yang', country: 'CH' })

    const res = await request(app).get('/auth/me/profile').set('Authorization', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body.givenName).toBe('Yang')
  })

  it('200 — returns a blank profile when none exists', async () => {
    prisma.profile.findUnique.mockResolvedValue(null)

    const res = await request(app).get('/auth/me/profile').set('Authorization', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body.givenName).toBeNull()
    expect(res.body.phoneVerified).toBe(false)
  })

  it('401 — without a token', async () => {
    const res = await request(app).get('/auth/me/profile')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /auth/me/profile', () => {
  it('200 — updates and returns the profile', async () => {
    prisma.profile.upsert.mockResolvedValue({ givenName: 'Yang', country: 'CH' })

    const res = await request(app)
      .patch('/auth/me/profile')
      .set('Authorization', TOKEN)
      .send({ givenName: 'Yang', country: 'ch' })

    expect(res.status).toBe(200)
    expect(res.body.country).toBe('CH')
    expect(prisma.profile.upsert).toHaveBeenCalled()
  })

  it('400 — invalid field, never writes', async () => {
    const res = await request(app)
      .patch('/auth/me/profile')
      .set('Authorization', TOKEN)
      .send({ phoneNumber: 'not-e164' })

    expect(res.status).toBe(400)
    expect(prisma.profile.upsert).not.toHaveBeenCalled()
  })

  it('400 — nothing to update', async () => {
    const res = await request(app).patch('/auth/me/profile').set('Authorization', TOKEN).send({})
    expect(res.status).toBe(400)
  })

  it('401 — without a token', async () => {
    const res = await request(app).patch('/auth/me/profile').send({ givenName: 'X' })
    expect(res.status).toBe(401)
  })
})
