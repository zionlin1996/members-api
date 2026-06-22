'use strict'

const crypto = require('crypto')
const prisma = require('../config/prisma')
const env = require('../config/env')
const { signAccessToken, signRefreshToken, refreshTokenExpiresAt } = require('../utils/jwt')
const { issueIdToken } = require('./oidc.service')

const MAX_AUTH_AGE_SECONDS = 86400 // 24 hours

const REGISTER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  status: true,
  createdAt: true,
}

function verifyTelegramData(telegramData) {
  const { hash, ...fields } = telegramData

  if (!hash) return false

  // Reject stale auth data (replay protection)
  if (fields.auth_date && Date.now() / 1000 - Number(fields.auth_date) > MAX_AUTH_AGE_SECONDS) {
    return false
  }

  // Build the data-check string: sorted key=value pairs joined by \n
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  // Key = SHA-256 of bot token
  const secretKey = crypto.createHash('sha256').update(env.TELEGRAM_BOT_TOKEN).digest()
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'))
}

async function registerWithTelegram({ telegramData, displayName, username }) {
  if (!verifyTelegramData(telegramData)) {
    const err = new Error('Invalid Telegram auth data')
    err.status = 401
    throw err
  }

  const telegramId = String(telegramData.id)

  const existing = await prisma.credential.findFirst({
    where: { type: 'TELEGRAM', providerId: telegramId },
    select: { id: true },
  })

  if (existing) {
    const err = new Error('Telegram account already linked to an existing member')
    err.status = 409
    throw err
  }

  const memberExists = await prisma.member.findUnique({ where: { username }, select: { id: true } })
  if (memberExists) {
    const err = new Error('Username already taken')
    err.status = 409
    throw err
  }

  return prisma.member.create({
    data: {
      displayName,
      username,
      credentials: {
        create: {
          type: 'TELEGRAM',
          providerId: telegramId,
          meta: {
            firstName: telegramData.first_name,
            lastName: telegramData.last_name,
            username: telegramData.username,
            photo: telegramData.photo_url,
          },
        },
      },
    },
    select: REGISTER_SELECT,
  })
}

// Authenticate-only seam: verify the Telegram widget HMAC, resolve the linked
// member, enforce SUSPENDED → 403 (UNVERIFIED allowed) but issue NO tokens.
// Reused by loginWithTelegram() and by the OIDC interaction login step.
async function verifyTelegram({ telegramData }) {
  if (!verifyTelegramData(telegramData)) {
    const err = new Error('Invalid Telegram auth data')
    err.status = 401
    throw err
  }

  const telegramId = String(telegramData.id)

  const cred = await prisma.credential.findFirst({
    where: { type: 'TELEGRAM', providerId: telegramId },
    include: { member: { select: { id: true, status: true } } },
  })

  if (!cred) {
    const err = new Error('No account linked to this Telegram account')
    err.status = 401
    throw err
  }

  // UNVERIFIED members may log in (limited, pending-approval view client-side);
  // only SUSPENDED accounts are denied a session.
  if (cred.member.status === 'SUSPENDED') {
    const err = new Error('Account suspended')
    err.status = 403
    throw err
  }

  return cred.member
}

async function loginWithTelegram({ telegramData }) {
  const member = await verifyTelegram({ telegramData })

  const accessToken = signAccessToken(member.id)
  const idToken = await issueIdToken(member.id)
  const refreshToken = signRefreshToken(member.id)

  await prisma.refreshToken.create({
    data: { token: refreshToken, memberId: member.id, expiresAt: refreshTokenExpiresAt() },
  })

  return { accessToken, idToken, refreshToken }
}

module.exports = { verifyTelegramData, registerWithTelegram, verifyTelegram, loginWithTelegram }
