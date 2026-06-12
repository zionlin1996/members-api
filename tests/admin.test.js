'use strict';

const request = require('supertest');

jest.mock('../src/config/prisma', () => ({
  member: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');

const API_KEY = 'test-admin-key';
const AUTH = `ApiKey ${API_KEY}`;

const MEMBER_ID = 'member-uuid-1';
const MEMBER = {
  id: MEMBER_ID,
  displayName: 'Test User',
  username: 'testuser',
  status: 'UNVERIFIED',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// POST /admin/members/:id/approve
// ---------------------------------------------------------------------------
describe('POST /admin/members/:id/approve', () => {
  it('200 — approves a member', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);
    prisma.member.update.mockResolvedValue({ id: MEMBER_ID, username: 'testuser', status: 'ACTIVE' });

    const res = await request(app)
      .post(`/admin/members/${MEMBER_ID}/approve`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.member.status).toBe('ACTIVE');
  });

  it('401 — missing API key', async () => {
    const res = await request(app).post(`/admin/members/${MEMBER_ID}/approve`);
    expect(res.status).toBe(401);
  });

  it('401 — wrong API key', async () => {
    const res = await request(app)
      .post(`/admin/members/${MEMBER_ID}/approve`)
      .set('Authorization', 'ApiKey wrong-key');
    expect(res.status).toBe(401);
  });

  it('404 — member not found', async () => {
    prisma.member.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/admin/members/non-existent/approve')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });

  it('409 — member already active', async () => {
    prisma.member.findUnique.mockResolvedValue({ ...MEMBER, status: 'ACTIVE' });

    const res = await request(app)
      .post(`/admin/members/${MEMBER_ID}/approve`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
describe('GET /auth/me', () => {
  const TOKEN = `Bearer ${signAccessToken(MEMBER_ID)}`;

  it('200 — returns current member', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);

    const res = await request(app).get('/auth/me').set('Authorization', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.member.id).toBe(MEMBER_ID);
    expect(res.body.member.password).toBeUndefined();
  });

  it('401 — missing token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('401 — invalid token', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });
});
