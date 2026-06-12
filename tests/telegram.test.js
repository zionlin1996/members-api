'use strict';

const crypto = require('crypto');
const request = require('supertest');

jest.mock('../src/config/prisma', () => ({
  member: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  credential: {
    findFirst: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
}));

const app = require('../src/app');
const prisma = require('../src/config/prisma');

// Build a valid Telegram auth payload signed with the test bot token
function buildTelegramData(overrides = {}) {
  const BOT_TOKEN = 'test_bot_token'; // matches tests/setup.js TELEGRAM_BOT_TOKEN
  const fields = {
    id: 12345678,
    first_name: 'Test',
    last_name: 'User',
    username: 'tguser',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };

  const dataCheckString = Object.keys(fields)
    .sort()
    .map(k => `${k}=${fields[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return { ...fields, hash };
}

const MEMBER = {
  id: 'member-uuid-1',
  displayName: 'Test User',
  username: 'testuser',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// POST /auth/register/telegram
// ---------------------------------------------------------------------------
describe('POST /auth/register/telegram', () => {
  it('201 — creates member with valid Telegram data', async () => {
    prisma.credential.findFirst.mockResolvedValue(null);
    prisma.member.findUnique.mockResolvedValue(null);
    prisma.member.create.mockResolvedValue(MEMBER);

    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'testuser',
      telegramData: buildTelegramData(),
    });

    expect(res.status).toBe(201);
    expect(res.body.member.username).toBe('testuser');
  });

  it('400 — missing displayName', async () => {
    const res = await request(app).post('/auth/register/telegram').send({
      username: 'testuser',
      telegramData: buildTelegramData(),
    });
    expect(res.status).toBe(400);
  });

  it('400 — missing telegramData', async () => {
    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'testuser',
    });
    expect(res.status).toBe(400);
  });

  it('400 — invalid username format', async () => {
    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'Bad Name!',
      telegramData: buildTelegramData(),
    });
    expect(res.status).toBe(400);
  });

  it('401 — tampered Telegram data', async () => {
    const data = buildTelegramData();
    data.first_name = 'Hacker'; // tamper after signing

    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'testuser',
      telegramData: data,
    });

    expect(res.status).toBe(401);
  });

  it('401 — stale auth_date', async () => {
    const staleDate = Math.floor(Date.now() / 1000) - 90000; // 25h ago
    const data = buildTelegramData({ auth_date: staleDate });

    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'testuser',
      telegramData: data,
    });

    expect(res.status).toBe(401);
  });

  it('409 — Telegram account already linked', async () => {
    prisma.credential.findFirst.mockResolvedValue({ id: 'cred-id' });

    const res = await request(app).post('/auth/register/telegram').send({
      displayName: 'Test User',
      username: 'testuser',
      telegramData: buildTelegramData(),
    });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login/telegram
// ---------------------------------------------------------------------------
describe('POST /auth/login/telegram', () => {
  it('200 — returns accessToken and sets cookie', async () => {
    prisma.credential.findFirst.mockResolvedValue({
      id: 'cred-id',
      member: { id: 'member-uuid-1', status: 'ACTIVE' },
    });
    prisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app).post('/auth/login/telegram').send({
      telegramData: buildTelegramData(),
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('400 — missing telegramData', async () => {
    const res = await request(app).post('/auth/login/telegram').send({});
    expect(res.status).toBe(400);
  });

  it('401 — tampered data', async () => {
    const data = buildTelegramData();
    data.id = 99999; // tamper

    const res = await request(app).post('/auth/login/telegram').send({ telegramData: data });
    expect(res.status).toBe(401);
  });

  it('401 — no account linked', async () => {
    prisma.credential.findFirst.mockResolvedValue(null);

    const res = await request(app).post('/auth/login/telegram').send({
      telegramData: buildTelegramData(),
    });

    expect(res.status).toBe(401);
  });

  it('403 — account pending approval', async () => {
    prisma.credential.findFirst.mockResolvedValue({
      id: 'cred-id',
      member: { id: 'member-uuid-1', status: 'UNVERIFIED' },
    });

    const res = await request(app).post('/auth/login/telegram').send({
      telegramData: buildTelegramData(),
    });

    expect(res.status).toBe(403);
  });
});
