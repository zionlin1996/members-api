'use strict';

const authService = require('../services/auth.service');
const { isValidUsername } = require('../utils/username');

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

module.exports = { registerPassword, login, refresh, logout, checkAvailability };
