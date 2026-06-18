'use strict'

const request = require('supertest')

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}))

jest.mock('../src/config/prisma', () => ({
  member: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  credential: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
  pendingChallenge: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}))

const app = require('../src/app')
const prisma = require('../src/config/prisma')
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server')

const MEMBER_ID = 'member-uuid-1'
const SESSION_ID = 'session-uuid-1'
const CHALLENGE = 'test-challenge-base64url'
const CREDENTIAL_ID = 'cred-id-base64url'

const MEMBER = {
  id: MEMBER_ID,
  displayName: 'Test User',
  username: 'testuser',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
}

const PENDING = {
  id: SESSION_ID,
  challenge: CHALLENGE,
  context: {
    displayName: 'Test User',
    username: 'testuser',
    backupEmail: 'backup@example.com',
    type: 'registration',
  },
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
}

const MOCK_OPTIONS = { challenge: CHALLENGE, rp: { id: 'localhost' } }

// ---------------------------------------------------------------------------
// POST /auth/register/passkey/start
// ---------------------------------------------------------------------------
describe('POST /auth/register/passkey/start', () => {
  it('200 — returns options and sessionId', async () => {
    prisma.member.findUnique.mockResolvedValue(null)
    generateRegistrationOptions.mockResolvedValue(MOCK_OPTIONS)
    prisma.pendingChallenge.create.mockResolvedValue({ id: SESSION_ID })

    const res = await request(app).post('/auth/register/passkey/start').send({
      displayName: 'Test User',
      username: 'testuser',
      backupEmail: 'backup@example.com',
    })

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe(SESSION_ID)
    expect(res.body.options).toBeDefined()
  })

  it('400 — missing displayName', async () => {
    const res = await request(app).post('/auth/register/passkey/start').send({
      username: 'testuser',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })

  it('400 — missing backupEmail', async () => {
    const res = await request(app).post('/auth/register/passkey/start').send({
      displayName: 'Test User',
      username: 'testuser',
    })
    expect(res.status).toBe(400)
  })

  it('400 — invalid username format', async () => {
    const res = await request(app).post('/auth/register/passkey/start').send({
      displayName: 'Test User',
      username: 'Bad User!',
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/register/passkey/finish
// ---------------------------------------------------------------------------
describe('POST /auth/register/passkey/finish', () => {
  const MOCK_CREDENTIAL = { id: CREDENTIAL_ID, type: 'public-key', response: {} }

  it('201 — creates member after successful verification', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(PENDING)
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: CREDENTIAL_ID,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
      },
    })
    prisma.pendingChallenge.delete.mockResolvedValue({})
    prisma.member.findUnique.mockResolvedValue(null)
    prisma.member.create.mockResolvedValue(MEMBER)

    const res = await request(app).post('/auth/register/passkey/finish').send({
      sessionId: SESSION_ID,
      credential: MOCK_CREDENTIAL,
    })

    expect(res.status).toBe(201)
    expect(res.body.member.username).toBe('testuser')
  })

  it('400 — missing sessionId', async () => {
    const res = await request(app).post('/auth/register/passkey/finish').send({
      credential: MOCK_CREDENTIAL,
    })
    expect(res.status).toBe(400)
  })

  it('400 — challenge expired or not found', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(null)
    prisma.pendingChallenge.deleteMany.mockResolvedValue({})

    const res = await request(app).post('/auth/register/passkey/finish').send({
      sessionId: SESSION_ID,
      credential: MOCK_CREDENTIAL,
    })

    expect(res.status).toBe(400)
  })

  it('400 — verification fails', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(PENDING)
    verifyRegistrationResponse.mockRejectedValue(new Error('bad response'))
    prisma.pendingChallenge.delete.mockResolvedValue({})

    const res = await request(app).post('/auth/register/passkey/finish').send({
      sessionId: SESSION_ID,
      credential: MOCK_CREDENTIAL,
    })

    expect(res.status).toBe(400)
  })

  it('409 — username already taken (race condition)', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(PENDING)
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: CREDENTIAL_ID,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: [],
        },
      },
    })
    prisma.pendingChallenge.delete.mockResolvedValue({})
    prisma.member.findUnique.mockResolvedValue({ id: 'other-id' })

    const res = await request(app).post('/auth/register/passkey/finish').send({
      sessionId: SESSION_ID,
      credential: MOCK_CREDENTIAL,
    })

    expect(res.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/login/passkey/start
// ---------------------------------------------------------------------------
describe('POST /auth/login/passkey/start', () => {
  it('200 — returns options and sessionId with username hint', async () => {
    prisma.member.findUnique.mockResolvedValue({
      ...MEMBER,
      credentials: [{ credentialId: CREDENTIAL_ID, meta: { transports: ['internal'] } }],
    })
    generateAuthenticationOptions.mockResolvedValue(MOCK_OPTIONS)
    prisma.pendingChallenge.create.mockResolvedValue({ id: SESSION_ID })

    const res = await request(app).post('/auth/login/passkey/start').send({ username: 'testuser' })

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe(SESSION_ID)
  })

  it('200 — returns options and sessionId without username (discoverable)', async () => {
    generateAuthenticationOptions.mockResolvedValue(MOCK_OPTIONS)
    prisma.pendingChallenge.create.mockResolvedValue({ id: SESSION_ID })

    const res = await request(app).post('/auth/login/passkey/start').send({})

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe(SESSION_ID)
  })
})

// ---------------------------------------------------------------------------
// POST /auth/login/passkey/finish
// ---------------------------------------------------------------------------
describe('POST /auth/login/passkey/finish', () => {
  const AUTH_PENDING = {
    id: SESSION_ID,
    challenge: CHALLENGE,
    context: { type: 'authentication' },
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }

  const STORED_CRED = {
    id: 'cred-db-id',
    credentialId: CREDENTIAL_ID,
    meta: {
      publicKey: Buffer.from([1, 2, 3]).toString('base64'),
      counter: 0,
      transports: ['internal'],
    },
    member: { id: MEMBER_ID, status: 'ACTIVE' },
  }

  it('200 — returns accessToken and sets cookie', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(AUTH_PENDING)
    prisma.credential.findUnique.mockResolvedValue(STORED_CRED)
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    })
    prisma.pendingChallenge.delete.mockResolvedValue({})
    prisma.credential.update.mockResolvedValue({})
    prisma.refreshToken.create.mockResolvedValue({})

    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        sessionId: SESSION_ID,
        credential: { id: CREDENTIAL_ID, type: 'public-key', response: {} },
      })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/)
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i)
  })

  it('400 — missing sessionId', async () => {
    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        credential: { id: CREDENTIAL_ID },
      })
    expect(res.status).toBe(400)
  })

  it('400 — challenge expired', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(null)
    prisma.pendingChallenge.deleteMany.mockResolvedValue({})

    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        sessionId: SESSION_ID,
        credential: { id: CREDENTIAL_ID },
      })

    expect(res.status).toBe(400)
  })

  it('401 — passkey not found', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(AUTH_PENDING)
    prisma.credential.findUnique.mockResolvedValue(null)
    prisma.pendingChallenge.delete.mockResolvedValue({})

    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        sessionId: SESSION_ID,
        credential: { id: 'unknown-cred-id' },
      })

    expect(res.status).toBe(401)
  })

  it('403 — account pending approval', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(AUTH_PENDING)
    prisma.credential.findUnique.mockResolvedValue({
      ...STORED_CRED,
      member: { id: MEMBER_ID, status: 'UNVERIFIED' },
    })
    prisma.pendingChallenge.delete.mockResolvedValue({})

    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        sessionId: SESSION_ID,
        credential: { id: CREDENTIAL_ID },
      })

    expect(res.status).toBe(403)
  })

  it('401 — verification fails', async () => {
    prisma.pendingChallenge.findUnique.mockResolvedValue(AUTH_PENDING)
    prisma.credential.findUnique.mockResolvedValue(STORED_CRED)
    verifyAuthenticationResponse.mockRejectedValue(new Error('invalid signature'))
    prisma.pendingChallenge.delete.mockResolvedValue({})

    const res = await request(app)
      .post('/auth/login/passkey/finish')
      .send({
        sessionId: SESSION_ID,
        credential: { id: CREDENTIAL_ID, type: 'public-key', response: {} },
      })

    expect(res.status).toBe(401)
  })
})
