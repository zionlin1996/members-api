'use strict'

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server')
const prisma = require('../config/prisma')
const env = require('../config/env')
const { signAccessToken, signRefreshToken, refreshTokenExpiresAt } = require('../utils/jwt')
const { issueIdToken } = require('./oidc.service')

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function startRegistration({ displayName, username, backupEmail }) {
  const existing = await prisma.member.findUnique({
    where: { username },
    include: {
      credentials: {
        where: { type: 'PASSKEY' },
        select: { credentialId: true, meta: true },
      },
    },
  })

  const excludeCredentials = existing
    ? existing.credentials.map((c) => ({ id: c.credentialId, transports: c.meta.transports || [] }))
    : []

  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userName: username,
    userDisplayName: displayName,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })

  const pending = await prisma.pendingChallenge.create({
    data: {
      challenge: options.challenge,
      context: { displayName, username, backupEmail, type: 'registration' },
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  })

  return { options, sessionId: pending.id }
}

async function finishRegistration({ sessionId, credential }) {
  const pending = await prisma.pendingChallenge.findUnique({ where: { id: sessionId } })

  if (!pending || pending.expiresAt < new Date()) {
    await prisma.pendingChallenge.deleteMany({ where: { id: sessionId } })
    const err = new Error('Challenge expired or not found')
    err.status = 400
    throw err
  }

  const { displayName, username, backupEmail } = pending.context

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
    })
  } catch {
    await prisma.pendingChallenge.delete({ where: { id: sessionId } })
    const err = new Error('Passkey registration verification failed')
    err.status = 400
    throw err
  }

  await prisma.pendingChallenge.delete({ where: { id: sessionId } })

  if (!verification.verified) {
    const err = new Error('Passkey registration verification failed')
    err.status = 400
    throw err
  }

  const { credential: regCred } = verification.registrationInfo

  const existingMember = await prisma.member.findUnique({
    where: { username },
    select: { id: true },
  })
  if (existingMember) {
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
          type: 'PASSKEY',
          credentialId: regCred.id,
          meta: {
            publicKey: Buffer.from(regCred.publicKey).toString('base64'),
            counter: regCred.counter,
            transports: regCred.transports || [],
            backupEmail,
          },
        },
      },
    },
    select: { id: true, displayName: true, username: true, status: true, createdAt: true },
  })
}

async function startAuthentication({ username }) {
  let allowCredentials = []

  if (username) {
    const member = await prisma.member.findUnique({
      where: { username },
      include: {
        credentials: {
          where: { type: 'PASSKEY' },
          select: { credentialId: true, meta: true },
        },
      },
    })

    if (member) {
      allowCredentials = member.credentials.map((c) => ({
        id: c.credentialId,
        transports: c.meta.transports || [],
      }))
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  })

  const pending = await prisma.pendingChallenge.create({
    data: {
      challenge: options.challenge,
      context: { type: 'authentication' },
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  })

  return { options, sessionId: pending.id }
}

async function finishAuthentication({ sessionId, credential }) {
  const pending = await prisma.pendingChallenge.findUnique({ where: { id: sessionId } })

  if (!pending || pending.expiresAt < new Date()) {
    await prisma.pendingChallenge.deleteMany({ where: { id: sessionId } })
    const err = new Error('Challenge expired or not found')
    err.status = 400
    throw err
  }

  const storedCred = await prisma.credential.findUnique({
    where: { credentialId: credential.id },
    include: { member: { select: { id: true, status: true } } },
  })

  if (!storedCred) {
    await prisma.pendingChallenge.delete({ where: { id: sessionId } })
    const err = new Error('Passkey not found')
    err.status = 401
    throw err
  }

  // UNVERIFIED members may log in (limited, pending-approval view client-side);
  // only SUSPENDED accounts are denied a session.
  if (storedCred.member.status === 'SUSPENDED') {
    await prisma.pendingChallenge.delete({ where: { id: sessionId } })
    const err = new Error('Account suspended')
    err.status = 403
    throw err
  }

  const publicKey = new Uint8Array(Buffer.from(storedCred.meta.publicKey, 'base64'))

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      credential: {
        id: storedCred.credentialId,
        publicKey,
        counter: storedCred.meta.counter,
        transports: storedCred.meta.transports,
      },
    })
  } catch {
    await prisma.pendingChallenge.delete({ where: { id: sessionId } })
    const err = new Error('Passkey authentication failed')
    err.status = 401
    throw err
  }

  await prisma.pendingChallenge.delete({ where: { id: sessionId } })

  if (!verification.verified) {
    const err = new Error('Passkey authentication failed')
    err.status = 401
    throw err
  }

  await prisma.credential.update({
    where: { id: storedCred.id },
    data: { meta: { ...storedCred.meta, counter: verification.authenticationInfo.newCounter } },
  })

  const accessToken = signAccessToken(storedCred.member.id)
  const idToken = await issueIdToken(storedCred.member.id)
  const refreshToken = signRefreshToken(storedCred.member.id)

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      memberId: storedCred.member.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  })

  return { accessToken, idToken, refreshToken }
}

module.exports = {
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
}
