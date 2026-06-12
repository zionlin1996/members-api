'use strict';

const authService = require('../services/auth.service');
const passkeyService = require('../services/passkey.service');
const googleService = require('../services/google.service');
const { isValidUsername } = require('../utils/username');
const { signStateToken, verifyStateToken } = require('../utils/jwt');

async function registerPassword(req, res, next) {
  try {
    const { displayName, username, password, backupEmail } = req.body;

    if (!displayName || !username || !password || !backupEmail) {
      return res.status(400).json({ message: 'displayName, username, password, and backupEmail are required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ message: 'Invalid username format' });
    }

    const member = await authService.registerPassword({ displayName, username, password, backupEmail });
    return res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }

    const { accessToken, refreshToken } = await authService.login({ username, password });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ message: 'Refresh token missing' });
    }

    const { accessToken, refreshToken } = await authService.refresh(token);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie('refreshToken');
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function checkAvailability(req, res, next) {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'username is required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ message: 'Invalid username format' });
    }

    const result = await authService.checkAvailability({ username });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function startPasskeyRegistration(req, res, next) {
  try {
    const { displayName, username, backupEmail } = req.body;

    if (!displayName || !username || !backupEmail) {
      return res.status(400).json({ message: 'displayName, username, and backupEmail are required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ message: 'Invalid username format' });
    }

    const result = await passkeyService.startRegistration({ displayName, username, backupEmail });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function finishPasskeyRegistration(req, res, next) {
  try {
    const { sessionId, credential } = req.body;

    if (!sessionId || !credential) {
      return res.status(400).json({ message: 'sessionId and credential are required' });
    }

    const member = await passkeyService.finishRegistration({ sessionId, credential });
    return res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
}

async function startPasskeyLogin(req, res, next) {
  try {
    const { username } = req.body;
    const result = await passkeyService.startAuthentication({ username });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function finishPasskeyLogin(req, res, next) {
  try {
    const { sessionId, credential } = req.body;

    if (!sessionId || !credential) {
      return res.status(400).json({ message: 'sessionId and credential are required' });
    }

    const { accessToken, refreshToken } = await passkeyService.finishAuthentication({ sessionId, credential });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

function redirectToGoogleRegister(req, res) {
  const { displayName, username } = req.query;

  if (!displayName || !username) {
    return res.status(400).json({ message: 'displayName and username are required' });
  }

  if (!isValidUsername(username)) {
    return res.status(400).json({ message: 'Invalid username format' });
  }

  const state = signStateToken({ flow: 'register', displayName, username });
  return res.redirect(googleService.buildAuthUrl(state));
}

function redirectToGoogleLogin(_req, res) {
  const state = signStateToken({ flow: 'login' });
  return res.redirect(googleService.buildAuthUrl(state));
}

async function handleGoogleCallback(req, res, next) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ message: `Google OAuth error: ${error}` });
    }

    if (!code || !state) {
      return res.status(400).json({ message: 'Missing code or state' });
    }

    let statePayload;
    try {
      statePayload = verifyStateToken(state);
    } catch {
      return res.status(400).json({ message: 'Invalid or expired state token' });
    }

    const profile = await googleService.fetchProfile(code);

    if (statePayload.flow === 'register') {
      const { displayName, username } = statePayload;
      const member = await googleService.registerWithGoogle({ profile, displayName, username });
      return res.status(201).json({ member });
    }

    const { accessToken, refreshToken } = await googleService.loginWithGoogle({ profile });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  registerPassword,
  login,
  refresh,
  logout,
  checkAvailability,
  startPasskeyRegistration,
  finishPasskeyRegistration,
  startPasskeyLogin,
  finishPasskeyLogin,
  redirectToGoogleRegister,
  redirectToGoogleLogin,
  handleGoogleCallback,
};
