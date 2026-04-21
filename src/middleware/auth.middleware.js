'use strict';

const { verifyAccessToken } = require('../utils/jwt');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or malformed' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.memberId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired access token' });
  }
}

module.exports = { authenticate };
