'use strict';

const env = require('../config/env');

function requireApiKey(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('ApiKey ')) {
    return res.status(401).json({ message: 'Admin API key required' });
  }

  const key = header.slice('ApiKey '.length);
  if (!env.ADMIN_API_KEY || key !== env.ADMIN_API_KEY) {
    return res.status(401).json({ message: 'Invalid API key' });
  }

  next();
}

module.exports = { requireApiKey };
