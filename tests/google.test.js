'use strict'

const request = require('supertest')

jest.mock('../src/services/google.service', () => ({
  buildAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
  fetchProfile: jest.fn(),
  registerWithGoogle: jest.fn(),
  loginWithGoogle: jest.fn(),
}))

const app = require('../src/app')
const googleService = require('../src/services/google.service')
const env = require('../src/config/env')
const { signStateToken } = require('../src/utils/jwt')

const MEMBER = {
  id: 'member-uuid-1',
  displayName: 'Test User',
  username: 'testuser',
  status: 'UNVERIFIED',
  createdAt: new Date('2024-01-01'),
}

const GOOGLE_PROFILE = { id: 'google-123', email: 'user@gmail.com', name: 'Test User' }

// ---------------------------------------------------------------------------
// GET /auth/register/google
// ---------------------------------------------------------------------------
describe('GET /auth/register/google', () => {
  it('302 — redirects to Google with valid params', async () => {
    const res = await request(app).get(
      '/auth/register/google?displayName=Test+User&username=testuser',
    )
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('accounts.google.com')
  })

  it('400 — missing displayName', async () => {
    const res = await request(app).get('/auth/register/google?username=testuser')
    expect(res.status).toBe(400)
  })

  it('400 — missing username', async () => {
    const res = await request(app).get('/auth/register/google?displayName=Test+User')
    expect(res.status).toBe(400)
  })

  it('400 — invalid username format', async () => {
    const res = await request(app).get(
      '/auth/register/google?displayName=Test+User&username=Bad+Name!',
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /auth/login/google
// ---------------------------------------------------------------------------
describe('GET /auth/login/google', () => {
  it('302 — redirects to Google', async () => {
    const res = await request(app).get('/auth/login/google')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('accounts.google.com')
  })
})

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------
describe('GET /auth/google/callback', () => {
  const LOGIN_TOKENS = {
    accessToken: 'access-token',
    idToken: 'id-token',
    refreshToken: 'refresh-token',
  }

  it('register flow → registers, establishes a session, redirects to the SPA', async () => {
    const state = signStateToken({
      flow: 'register',
      displayName: 'Test User',
      username: 'testuser',
    })
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE)
    googleService.registerWithGoogle.mockResolvedValue(MEMBER)
    googleService.loginWithGoogle.mockResolvedValue(LOGIN_TOKENS)

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`)

    expect(googleService.registerWithGoogle).toHaveBeenCalled()
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(env.APP_ORIGIN)
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/)
  })

  it('login flow → establishes a session and redirects to the SPA', async () => {
    const state = signStateToken({ flow: 'login' })
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE)
    googleService.loginWithGoogle.mockResolvedValue(LOGIN_TOKENS)

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(env.APP_ORIGIN)
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/)
  })

  it('missing code → redirects to login with an error', async () => {
    const state = signStateToken({ flow: 'login' })
    const res = await request(app).get(`/auth/google/callback?state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(`${env.APP_ORIGIN}/login?error=`)
  })

  it('invalid state token → redirects to login with an error', async () => {
    const res = await request(app).get('/auth/google/callback?code=auth-code&state=not-a-valid-jwt')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(`${env.APP_ORIGIN}/login?error=`)
  })

  it('user cancelled (access_denied) → redirects to login without an error banner', async () => {
    const res = await request(app).get('/auth/google/callback?error=access_denied')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${env.APP_ORIGIN}/login`)
  })

  it('duplicate Google account (register) → redirects to login with the error message', async () => {
    const state = signStateToken({
      flow: 'register',
      displayName: 'Test User',
      username: 'testuser',
    })
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE)
    const err = Object.assign(new Error('Google account already linked to an existing member'), {
      status: 409,
    })
    googleService.registerWithGoogle.mockRejectedValue(err)

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain(`${env.APP_ORIGIN}/login?error=`)
    expect(decodeURIComponent(res.headers.location)).toContain('already linked')
  })

  it('SUSPENDED account on login → redirects to login with the error message', async () => {
    const state = signStateToken({ flow: 'login' })
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE)
    googleService.loginWithGoogle.mockRejectedValue(
      Object.assign(new Error('Account suspended'), { status: 403 }),
    )

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`)

    expect(res.status).toBe(302)
    expect(decodeURIComponent(res.headers.location)).toContain('Account suspended')
  })
})
