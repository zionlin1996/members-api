'use strict';

const prisma = require('../config/prisma');
const env = require('../config/env');
const { signAccessToken, signRefreshToken, refreshTokenExpiresAt } = require('../utils/jwt');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const REGISTER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  status: true,
  createdAt: true,
};

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function fetchProfile(code) {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    const err = new Error('Google token exchange failed');
    err.status = 400;
    throw err;
  }

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  return profileRes.json();
}

async function registerWithGoogle({ profile, displayName, username }) {
  const existing = await prisma.credential.findFirst({
    where: { type: 'GOOGLE', providerId: profile.id },
    select: { id: true },
  });

  if (existing) {
    const err = new Error('Google account already linked to an existing member');
    err.status = 409;
    throw err;
  }

  const memberExists = await prisma.member.findUnique({ where: { username }, select: { id: true } });
  if (memberExists) {
    const err = new Error('Username already taken');
    err.status = 409;
    throw err;
  }

  return prisma.member.create({
    data: {
      displayName,
      username,
      credentials: {
        create: {
          type: 'GOOGLE',
          providerId: profile.id,
          meta: { email: profile.email, name: profile.name, photo: profile.picture },
        },
      },
    },
    select: REGISTER_SELECT,
  });
}

async function loginWithGoogle({ profile }) {
  const cred = await prisma.credential.findFirst({
    where: { type: 'GOOGLE', providerId: profile.id },
    include: { member: { select: { id: true, status: true } } },
  });

  if (!cred) {
    const err = new Error('No account linked to this Google profile');
    err.status = 401;
    throw err;
  }

  if (cred.member.status !== 'ACTIVE') {
    const err = new Error('Account pending approval');
    err.status = 403;
    throw err;
  }

  const accessToken = signAccessToken(cred.member.id);
  const refreshToken = signRefreshToken(cred.member.id);

  await prisma.refreshToken.create({
    data: { token: refreshToken, memberId: cred.member.id, expiresAt: refreshTokenExpiresAt() },
  });

  return { accessToken, refreshToken };
}

module.exports = { buildAuthUrl, fetchProfile, registerWithGoogle, loginWithGoogle };
