'use strict'

const request = require('supertest')
const bcrypt = require('bcryptjs')

jest.mock('../src/config/prisma', () => ({
  member: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}))

const app = require('../src/app')
const prisma = require('../src/config/prisma')
const { signRefreshToken, signAccessToken } = require('../src/utils/jwt')

const MEMBER_ID = 'member-uuid-1'

const MEMBER = {
  id: MEMBER_ID,
  displayName: 'Test User',
  username: 'testuser',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// POST /auth/register/password
// ---------------------------------------------------------------------------
describe('POST /auth/register/password', () => {
  it('201 — creates member with valid data', async () => {
    prisma.member.findUnique.mockResolvedValue(null)
    prisma.member.create.mockResolvedValue(MEMBER)

    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      username: 'testuser',
      password: 'password123',
      backupEmail: 'backup@example.com',
    })

    expect(res.status).toBe(201)
    expect(res.body.member.username).toBe('testuser')
    expect(res.body.member.password).toBeUndefined()
  })

  it('400 — missing displayName', async () => {
    const res = await request(app).post('/auth/register/password').send({
      username: 'testuser',
      password: 'password123',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })

  it('400 — missing username', async () => {
    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      password: 'password123',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })

  it('400 — missing password', async () => {
    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      username: 'testuser',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })

  it('400 — missing backupEmail', async () => {
    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      username: 'testuser',
      password: 'password123',
    })
    expect(res.status).toBe(400)
  })

  it('400 — invalid username format', async () => {
    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      username: 'Invalid User Name!',
      password: 'password123',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })

  it('409 — username already taken', async () => {
    prisma.member.findUnique.mockResolvedValue({ id: 'existing-id' })

    const res = await request(app).post('/auth/register/password').send({
      displayName: 'Test User',
      username: 'testuser',
      password: 'password123',
      backupEmail: 'backup@example.com',
    })

    expect(res.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
describe('POST /auth/login', () => {
  it('200 — returns accessToken and sets httpOnly refreshToken cookie', async () => {
    const hash = await bcrypt.hash('password123', 1)
    prisma.member.findUnique.mockResolvedValue({
      ...MEMBER,
      credentials: [{ meta: { passwordHash: hash } }],
    })
    prisma.refreshToken.create.mockResolvedValue({})

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'password123',
    })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
    expect(res.headers['set-cookie']).toBeDefined()
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/)
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i)
  })

  it('400 — missing username', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'password123' })
    expect(res.status).toBe(400)
  })

  it('400 — missing password', async () => {
    const res = await request(app).post('/auth/login').send({ username: 'testuser' })
    expect(res.status).toBe(400)
  })

  it('401 — unknown username', async () => {
    prisma.member.findUnique.mockResolvedValue(null)

    const res = await request(app).post('/auth/login').send({
      username: 'unknown',
      password: 'password123',
    })

    expect(res.status).toBe(401)
  })

  it('401 — wrong password', async () => {
    const hash = await bcrypt.hash('correct-password', 1)
    prisma.member.findUnique.mockResolvedValue({
      ...MEMBER,
      credentials: [{ meta: { passwordHash: hash } }],
    })

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'wrong-password',
    })

    expect(res.status).toBe(401)
  })

  it('200 — UNVERIFIED member may log in', async () => {
    const hash = await bcrypt.hash('password123', 1)
    prisma.member.findUnique.mockResolvedValue({
      ...MEMBER,
      status: 'UNVERIFIED',
      credentials: [{ meta: { passwordHash: hash } }],
    })
    prisma.refreshToken.create.mockResolvedValue({})

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'password123',
    })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
  })

  it('403 — SUSPENDED account is denied', async () => {
    const hash = await bcrypt.hash('password123', 1)
    prisma.member.findUnique.mockResolvedValue({
      ...MEMBER,
      status: 'SUSPENDED',
      credentials: [{ meta: { passwordHash: hash } }],
    })

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'password123',
    })

    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------
describe('POST /auth/refresh', () => {
  it('200 — rotates token and returns new accessToken', async () => {
    const token = signRefreshToken(MEMBER_ID)
    prisma.refreshToken.findUnique.mockResolvedValue({
      token,
      memberId: MEMBER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    prisma.refreshToken.delete.mockResolvedValue({})
    prisma.refreshToken.create.mockResolvedValue({})

    const res = await request(app).post('/auth/refresh').set('Cookie', `refreshToken=${token}`)

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/)
  })

  it('401 — missing cookie', async () => {
    const res = await request(app).post('/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('401 — token fails JWT verification', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', 'refreshToken=this.is.not.valid')
    expect(res.status).toBe(401)
  })

  it('401 — valid JWT but not found in DB', async () => {
    const token = signRefreshToken(MEMBER_ID)
    prisma.refreshToken.findUnique.mockResolvedValue(null)

    const res = await request(app).post('/auth/refresh').set('Cookie', `refreshToken=${token}`)

    expect(res.status).toBe(401)
  })

  it('401 — token is expired in DB', async () => {
    const token = signRefreshToken(MEMBER_ID)
    prisma.refreshToken.findUnique.mockResolvedValue({
      token,
      memberId: MEMBER_ID,
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await request(app).post('/auth/refresh').set('Cookie', `refreshToken=${token}`)

    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
describe('POST /auth/logout', () => {
  it('204 — invalidates token and clears cookie', async () => {
    const token = signRefreshToken(MEMBER_ID)
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 })

    const res = await request(app).post('/auth/logout').set('Cookie', `refreshToken=${token}`)

    expect(res.status).toBe(204)
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=;/)
  })

  it('204 — succeeds even with no cookie present', async () => {
    const res = await request(app).post('/auth/logout')
    expect(res.status).toBe(204)
  })
})

// ---------------------------------------------------------------------------
// GET /auth/availability
// ---------------------------------------------------------------------------
describe('GET /auth/availability', () => {
  it('400 — no query params provided', async () => {
    const res = await request(app).get('/auth/availability')
    expect(res.status).toBe(400)
  })

  it('400 — invalid username format', async () => {
    const res = await request(app).get('/auth/availability?username=Invalid+Name!')
    expect(res.status).toBe(400)
  })

  it('200 — username is available', async () => {
    prisma.member.findUnique.mockResolvedValue(null)

    const res = await request(app).get('/auth/availability?username=freeuser')

    expect(res.status).toBe(200)
    expect(res.body.username).toEqual({ available: true })
  })

  it('200 — username is taken', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER)

    const res = await request(app).get('/auth/availability?username=testuser')

    expect(res.status).toBe(200)
    expect(res.body.username).toEqual({ available: false })
  })
})

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
describe('GET /auth/me', () => {
  const TOKEN = `Bearer ${signAccessToken(MEMBER_ID)}`

  it('200 — returns a flat member object (no wrapper)', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER)

    const res = await request(app).get('/auth/me').set('Authorization', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body.member).toBeUndefined() // flat, not { member: {...} }
    expect(res.body.id).toBe(MEMBER_ID)
    expect(res.body.username).toBe('testuser')
    expect(res.body.password).toBeUndefined()
  })

  it('401 — missing Authorization header', async () => {
    const res = await request(app).get('/auth/me')
    expect(res.status).toBe(401)
  })

  it('401 — invalid token', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer bad.token.here')
    expect(res.status).toBe(401)
  })
})
