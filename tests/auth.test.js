'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');

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
}));

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { signRefreshToken } = require('../src/utils/jwt');

const MEMBER = {
  id: 'member-uuid-1',
  username: 'testuser',
  assignedEmail: 'assigned@example.com',
  backupEmail: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
describe('POST /auth/register', () => {
  it('201 — creates member with valid data', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    prisma.member.create.mockResolvedValue(MEMBER);

    const res = await request(app).post('/auth/register').send({
      username: 'testuser',
      password: 'password123',
      assignedEmail: 'assigned@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.member.username).toBe('testuser');
    expect(res.body.member.password).toBeUndefined();
  });

  it('201 — creates member with optional backupEmail', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    prisma.member.create.mockResolvedValue({ ...MEMBER, backupEmail: 'backup@example.com' });

    const res = await request(app).post('/auth/register').send({
      username: 'testuser',
      password: 'password123',
      assignedEmail: 'assigned@example.com',
      backupEmail: 'backup@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.member.backupEmail).toBe('backup@example.com');
  });

  it('400 — missing username', async () => {
    const res = await request(app).post('/auth/register').send({
      password: 'password123',
      assignedEmail: 'assigned@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('400 — missing password', async () => {
    const res = await request(app).post('/auth/register').send({
      username: 'testuser',
      assignedEmail: 'assigned@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('400 — missing assignedEmail', async () => {
    const res = await request(app).post('/auth/register').send({
      username: 'testuser',
      password: 'password123',
    });
    expect(res.status).toBe(400);
  });

  it('409 — username already taken', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...MEMBER, username: 'testuser' });

    const res = await request(app).post('/auth/register').send({
      username: 'testuser',
      password: 'password123',
      assignedEmail: 'other@example.com',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/username/);
  });

  it('409 — assignedEmail already taken', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...MEMBER, username: 'otheruser' });

    const res = await request(app).post('/auth/register').send({
      username: 'newuser',
      password: 'password123',
      assignedEmail: 'assigned@example.com',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/assignedEmail/);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
describe('POST /auth/login', () => {
  it('200 — returns accessToken and sets httpOnly refreshToken cookie', async () => {
    const hash = await bcrypt.hash('password123', 1);
    prisma.member.findUnique.mockResolvedValue({ ...MEMBER, password: hash });
    prisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('400 — missing username', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('400 — missing password', async () => {
    const res = await request(app).post('/auth/login').send({ username: 'testuser' });
    expect(res.status).toBe(400);
  });

  it('401 — unknown username', async () => {
    prisma.member.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/auth/login').send({
      username: 'unknown',
      password: 'password123',
    });

    expect(res.status).toBe(401);
  });

  it('401 — wrong password', async () => {
    const hash = await bcrypt.hash('correct-password', 1);
    prisma.member.findUnique.mockResolvedValue({ ...MEMBER, password: hash });

    const res = await request(app).post('/auth/login').send({
      username: 'testuser',
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------
describe('POST /auth/refresh', () => {
  it('200 — rotates token and returns new accessToken', async () => {
    const token = signRefreshToken(MEMBER.id);
    prisma.refreshToken.findUnique.mockResolvedValue({
      token,
      memberId: MEMBER.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    prisma.refreshToken.delete.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
  });

  it('401 — missing cookie', async () => {
    const res = await request(app).post('/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('401 — token fails JWT verification', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', 'refreshToken=this.is.not.valid');
    expect(res.status).toBe(401);
  });

  it('401 — valid JWT but not found in DB', async () => {
    const token = signRefreshToken(MEMBER.id);
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(401);
  });

  it('401 — token is expired in DB', async () => {
    const token = signRefreshToken(MEMBER.id);
    prisma.refreshToken.findUnique.mockResolvedValue({
      token,
      memberId: MEMBER.id,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
describe('POST /auth/logout', () => {
  it('204 — invalidates token and clears cookie', async () => {
    const token = signRefreshToken(MEMBER.id);
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `refreshToken=${token}`);

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=;/);
  });

  it('204 — succeeds even with no cookie present', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(204);
  });
});
