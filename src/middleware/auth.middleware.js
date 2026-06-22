'use strict'

const { verifyAccessToken } = require('../utils/jwt')
const memberService = require('../services/member.service')

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or malformed' })
  }

  const token = authHeader.slice(7)
  try {
    const payload = verifyAccessToken(token)
    req.memberId = payload.sub
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired access token' })
  }
}

// Gates routes that expose profile details to ACTIVE members only. UNVERIFIED
// members can hold a session (and read /auth/me to learn their status), but the
// detail getters return 403 so the client shows a pending-approval view instead.
// Runs after authenticate(); relies on req.memberId.
async function requireActive(req, res, next) {
  try {
    const member = await memberService.findById(req.memberId)
    if (member.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'Account pending approval' })
    }
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { authenticate, requireActive }
