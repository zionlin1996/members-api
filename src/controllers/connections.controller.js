'use strict'

const connectionsService = require('../services/connections.service')

// Member-facing management of authorized third-party apps (OIDC grants).

async function listConnections(req, res, next) {
  try {
    return res.json({ connections: await connectionsService.list(req.memberId) })
  } catch (err) {
    next(err)
  }
}

async function revokeConnection(req, res, next) {
  try {
    await connectionsService.revoke(req.memberId, req.params.clientId)
    return res.status(204).end()
  } catch (err) {
    next(err)
  }
}

module.exports = { listConnections, revokeConnection }
