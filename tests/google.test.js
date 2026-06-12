'use strict';

const request = require('supertest');

jest.mock('../src/services/google.service', () => ({
  buildAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
  fetchProfile: jest.fn(),
  registerWithGoogle: jest.fn(),
  loginWithGoogle: jest.fn(),
}));

const app = require('../src/app');
const googleService = require('../src/services/google.service');
const { signStateToken } = require('../src/utils/jwt');

const MEMBER = {
  id: 'member-uuid-1',
  displayName: 'Test User',
  username: 'testuser',
  status: 'UNVERIFIED',
  createdAt: new Date('2024-01-01'),
};

const GOOGLE_PROFILE = { id: 'google-123', email: 'user@gmail.com', name: 'Test User' };

// ---------------------------------------------------------------------------
// GET /auth/register/google
// ---------------------------------------------------------------------------
describe('GET /auth/register/google', () => {
  it('302 — redirects to Google with valid params', async () => {
    const res = await request(app).get('/auth/register/google?displayName=Test+User&username=testuser');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('400 — missing displayName', async () => {
    const res = await request(app).get('/auth/register/google?username=testuser');
    expect(res.status).toBe(400);
  });

  it('400 — missing username', async () => {
    const res = await request(app).get('/auth/register/google?displayName=Test+User');
    expect(res.status).toBe(400);
  });

  it('400 — invalid username format', async () => {
    const res = await request(app).get('/auth/register/google?displayName=Test+User&username=Bad+Name!');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/login/google
// ---------------------------------------------------------------------------
describe('GET /auth/login/google', () => {
  it('302 — redirects to Google', async () => {
    const res = await request(app).get('/auth/login/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------
describe('GET /auth/google/callback', () => {
  it('201 — registers new member on register flow', async () => {
    const state = signStateToken({ flow: 'register', displayName: 'Test User', username: 'testuser' });
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE);
    googleService.registerWithGoogle.mockResolvedValue(MEMBER);

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(201);
    expect(res.body.member.username).toBe('testuser');
  });

  it('200 — logs in existing member on login flow', async () => {
    const state = signStateToken({ flow: 'login' });
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE);
    googleService.loginWithGoogle.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access-token');
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
  });

  it('400 — missing code', async () => {
    const state = signStateToken({ flow: 'login' });
    const res = await request(app).get(`/auth/google/callback?state=${state}`);
    expect(res.status).toBe(400);
  });

  it('400 — invalid state token', async () => {
    const res = await request(app).get('/auth/google/callback?code=auth-code&state=not-a-valid-jwt');
    expect(res.status).toBe(400);
  });

  it('400 — Google OAuth error param', async () => {
    const res = await request(app).get('/auth/google/callback?error=access_denied');
    expect(res.status).toBe(400);
  });

  it('409 — Google account already registered', async () => {
    const state = signStateToken({ flow: 'register', displayName: 'Test User', username: 'testuser' });
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE);
    const err = new Error('Google account already linked to an existing member');
    err.status = 409;
    googleService.registerWithGoogle.mockRejectedValue(err);

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(409);
  });

  it('401 — no account linked on login flow', async () => {
    const state = signStateToken({ flow: 'login' });
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE);
    const err = new Error('No account linked to this Google profile');
    err.status = 401;
    googleService.loginWithGoogle.mockRejectedValue(err);

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(401);
  });

  it('403 — account pending approval on login', async () => {
    const state = signStateToken({ flow: 'login' });
    googleService.fetchProfile.mockResolvedValue(GOOGLE_PROFILE);
    const err = new Error('Account pending approval');
    err.status = 403;
    googleService.loginWithGoogle.mockRejectedValue(err);

    const res = await request(app).get(`/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(403);
  });
});
