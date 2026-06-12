'use strict';

const request = require('supertest');

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
const { signAccessToken } = require('../src/utils/jwt');

const MEMBER_ID = 'member-uuid-1';
const TOKEN = `Bearer ${signAccessToken(MEMBER_ID)}`;

const MEMBER = {
  id: MEMBER_ID,
  displayName: 'Test User',
  username: 'testuser',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// GET /members
// ---------------------------------------------------------------------------
describe('GET /members', () => {
  it('200 — returns list of members', async () => {
    prisma.member.findMany.mockResolvedValue([MEMBER]);

    const res = await request(app).get('/members').set('Authorization', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].id).toBe(MEMBER_ID);
    expect(res.body.members[0].password).toBeUndefined();
  });

  it('200 — returns empty array when no members exist', async () => {
    prisma.member.findMany.mockResolvedValue([]);

    const res = await request(app).get('/members').set('Authorization', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(0);
  });

  it('401 — missing Authorization header', async () => {
    const res = await request(app).get('/members');
    expect(res.status).toBe(401);
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .get('/members')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /members/:id
// ---------------------------------------------------------------------------
describe('GET /members/:id', () => {
  it('200 — returns the member', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);

    const res = await request(app)
      .get(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.member.id).toBe(MEMBER_ID);
    expect(res.body.member.password).toBeUndefined();
  });

  it('401 — missing Authorization header', async () => {
    const res = await request(app).get(`/members/${MEMBER_ID}`);
    expect(res.status).toBe(401);
  });

  it('404 — member does not exist', async () => {
    prisma.member.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/members/non-existent-id')
      .set('Authorization', TOKEN);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /members/:id
// ---------------------------------------------------------------------------
describe('PATCH /members/:id', () => {
  it('200 — updates username', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);
    prisma.member.update.mockResolvedValue({ ...MEMBER, username: 'newname' });

    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN)
      .send({ username: 'newname' });

    expect(res.status).toBe(200);
    expect(res.body.member.username).toBe('newname');
  });

  it('200 — updates displayName', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);
    prisma.member.update.mockResolvedValue({ ...MEMBER, displayName: 'New Name' });

    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN)
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.member.displayName).toBe('New Name');
  });

  it('400 — no updatable fields provided', async () => {
    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN)
      .send({ unknownField: 'value' });

    expect(res.status).toBe(400);
  });

  it('400 — invalid username format', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);

    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN)
      .send({ username: 'Invalid Name!' });

    expect(res.status).toBe(400);
  });

  it('401 — missing Authorization header', async () => {
    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .send({ username: 'newname' });
    expect(res.status).toBe(401);
  });

  it('404 — member does not exist', async () => {
    prisma.member.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/members/non-existent-id')
      .set('Authorization', TOKEN)
      .send({ username: 'newname' });

    expect(res.status).toBe(404);
  });

  it('409 — username already taken', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);
    prisma.member.update.mockRejectedValue({ code: 'P2002', meta: { target: ['username'] } });

    const res = await request(app)
      .patch(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN)
      .send({ username: 'takenname' });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// DELETE /members/:id
// ---------------------------------------------------------------------------
describe('DELETE /members/:id', () => {
  it('204 — deletes the member', async () => {
    prisma.member.findUnique.mockResolvedValue(MEMBER);
    prisma.member.delete.mockResolvedValue({});

    const res = await request(app)
      .delete(`/members/${MEMBER_ID}`)
      .set('Authorization', TOKEN);

    expect(res.status).toBe(204);
    expect(prisma.member.delete).toHaveBeenCalledWith({ where: { id: MEMBER_ID } });
  });

  it('401 — missing Authorization header', async () => {
    const res = await request(app).delete(`/members/${MEMBER_ID}`);
    expect(res.status).toBe(401);
  });

  it('404 — member does not exist', async () => {
    prisma.member.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/members/non-existent-id')
      .set('Authorization', TOKEN);

    expect(res.status).toBe(404);
  });
});
