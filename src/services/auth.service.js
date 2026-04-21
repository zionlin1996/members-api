'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
} = require('../utils/jwt');

async function register({ username, password, assignedEmail, backupEmail }) {
  const existing = await prisma.member.findFirst({
    where: { OR: [{ username }, { assignedEmail }] },
  });
  if (existing) {
    const field = existing.username === username ? 'username' : 'assignedEmail';
    const err = new Error(`${field} is already taken`);
    err.status = 409;
    throw err;
  }

  const hashed = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const member = await prisma.member.create({
    data: { username, password: hashed, assignedEmail, backupEmail },
    select: { id: true, username: true, assignedEmail: true, backupEmail: true, createdAt: true },
  });

  return member;
}

async function login({ username, password }) {
  const member = await prisma.member.findUnique({ where: { username } });
  if (!member) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, member.password);
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const accessToken = signAccessToken(member.id);
  const refreshToken = signRefreshToken(member.id);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      memberId: member.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  return { accessToken, refreshToken };
}

async function refresh(token) {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored || stored.expiresAt < new Date()) {
    const err = new Error('Refresh token not found or expired');
    err.status = 401;
    throw err;
  }

  // Rotate: delete old, issue new
  await prisma.refreshToken.delete({ where: { token } });

  const newRefreshToken = signRefreshToken(payload.sub);
  await prisma.refreshToken.create({
    data: {
      token: newRefreshToken,
      memberId: payload.sub,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  const accessToken = signAccessToken(payload.sub);
  return { accessToken, refreshToken: newRefreshToken };
}

async function logout(token) {
  await prisma.refreshToken.deleteMany({ where: { token } });
}

module.exports = { register, login, refresh, logout };
