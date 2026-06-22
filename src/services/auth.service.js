'use strict'

const bcrypt = require('bcryptjs')
const prisma = require('../config/prisma')
const env = require('../config/env')
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
} = require('../utils/jwt')
const { issueIdToken } = require('./oidc.service')

const REGISTER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  status: true,
  createdAt: true,
}

async function registerPassword({ displayName, username, password, backupEmail }) {
  const existing = await prisma.member.findUnique({ where: { username }, select: { id: true } })
  if (existing) {
    const err = new Error('Username already taken')
    err.status = 409
    throw err
  }

  const hashed = await bcrypt.hash(password, env.BCRYPT_ROUNDS)
  return prisma.member.create({
    data: {
      displayName,
      username,
      credentials: {
        create: {
          type: 'PASSWORD',
          meta: { passwordHash: hashed, backupEmail },
        },
      },
    },
    select: REGISTER_SELECT,
  })
}

// Authenticate-only seam: verify a username/password and return the member,
// enforcing SUSPENDED → 403 (UNVERIFIED is allowed) but issuing NO tokens.
// Reused by login() below and by the OIDC interaction login step (which needs
// the member id without minting a first-party session).
async function verifyPassword({ username, password }) {
  const member = await prisma.member.findUnique({
    where: { username },
    include: { credentials: { where: { type: 'PASSWORD' } } },
  })

  if (!member || !member.credentials.length) {
    const err = new Error('Invalid credentials')
    err.status = 401
    throw err
  }

  // UNVERIFIED members may log in (they get a limited, pending-approval view on
  // the client); only SUSPENDED accounts are denied a session.
  if (member.status === 'SUSPENDED') {
    const err = new Error('Account suspended')
    err.status = 403
    throw err
  }

  const { passwordHash } = member.credentials[0].meta
  const valid = await bcrypt.compare(password, passwordHash)
  if (!valid) {
    const err = new Error('Invalid credentials')
    err.status = 401
    throw err
  }

  return member
}

async function login({ username, password }) {
  const member = await verifyPassword({ username, password })

  const accessToken = signAccessToken(member.id)
  const idToken = await issueIdToken(member.id)
  const refreshToken = signRefreshToken(member.id)

  await prisma.refreshToken.create({
    data: { token: refreshToken, memberId: member.id, expiresAt: refreshTokenExpiresAt() },
  })

  return { accessToken, idToken, refreshToken }
}

async function refresh(token) {
  let payload
  try {
    payload = verifyRefreshToken(token)
  } catch {
    const err = new Error('Invalid or expired refresh token')
    err.status = 401
    throw err
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } })
  if (!stored || stored.expiresAt < new Date()) {
    const err = new Error('Refresh token not found or expired')
    err.status = 401
    throw err
  }

  await prisma.refreshToken.delete({ where: { token } })

  const newRefreshToken = signRefreshToken(payload.sub)
  await prisma.refreshToken.create({
    data: { token: newRefreshToken, memberId: payload.sub, expiresAt: refreshTokenExpiresAt() },
  })

  const accessToken = signAccessToken(payload.sub)
  const idToken = await issueIdToken(payload.sub)
  return { accessToken, idToken, refreshToken: newRefreshToken }
}

async function logout(token) {
  await prisma.refreshToken.deleteMany({ where: { token } })
}

async function checkAvailability({ username }) {
  const existing = await prisma.member.findUnique({ where: { username }, select: { id: true } })
  return { username: { available: !existing } }
}

module.exports = { registerPassword, verifyPassword, login, refresh, logout, checkAvailability }
