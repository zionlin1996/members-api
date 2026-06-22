'use strict'

jest.mock('../src/config/prisma', () => ({
  member: { findUnique: jest.fn() },
  profile: { findUnique: jest.fn() },
}))

const request = require('supertest')
const app = require('../src/app')
const prisma = require('../src/config/prisma')
const { signAccessToken } = require('../src/utils/jwt')

const MEMBER_ID = 'member-uuid-1'
const TOKEN = `Bearer ${signAccessToken(MEMBER_ID)}`
const NS = 'https://yangfrenz.club/'

beforeEach(() => jest.clearAllMocks())

describe('GET /auth/userinfo', () => {
  it('200 — returns full first-party claims from member + profile', async () => {
    prisma.member.findUnique.mockResolvedValue({
      id: MEMBER_ID,
      displayName: 'Yang Lin',
      username: 'yang.lin',
      status: 'ACTIVE',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-06-01T00:00:00.000Z'),
    })
    prisma.profile.findUnique.mockResolvedValue({
      givenName: 'Yang',
      birthdate: new Date('1990-05-20T00:00:00.000Z'),
      country: 'CH',
      locality: 'Zurich',
      pronouns: 'he/him',
    })

    const res = await request(app).get('/auth/userinfo').set('Authorization', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body.sub).toBe(MEMBER_ID)
    expect(res.body.given_name).toBe('Yang')
    expect(res.body.birthdate).toBe('1990-05-20')
    expect(res.body.email).toMatch(/^yang\.lin@/)
    expect(res.body.address).toMatchObject({ country: 'CH', locality: 'Zurich' })
    expect(res.body[`${NS}pronouns`]).toBe('he/him')
  })

  it('200 — works with no profile row (member-derived claims only)', async () => {
    prisma.member.findUnique.mockResolvedValue({
      id: MEMBER_ID,
      displayName: 'Yang Lin',
      username: 'yang.lin',
      status: 'ACTIVE',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-06-01T00:00:00.000Z'),
    })
    prisma.profile.findUnique.mockResolvedValue(null)

    const res = await request(app).get('/auth/userinfo').set('Authorization', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Yang Lin')
    expect(res.body.given_name).toBeUndefined()
  })

  it('401 — without a token', async () => {
    const res = await request(app).get('/auth/userinfo')
    expect(res.status).toBe(401)
  })
})
